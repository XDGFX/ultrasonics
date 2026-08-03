# ADR-0010 — Worker-shaped plugin boundary, in-process execution in Phase 1

**Status:** Proposed
**Date:** 2026-08-03
**Refines:** ADR-0001 (which wanted isolation but did not choose a mechanism), ADR-0004 (the SDK
contract this constrains)
**Evidence:** [`docs/reference/plugin-isolation-research.md`](../reference/plugin-isolation-research.md)
— measured on Bun 1.3.13, macOS arm64

## Context

ADR-0001 asked for plugin isolation so that one bad plugin cannot crash a sync, but did not say how.
Map ticket 003 owned the choice, and it had to resolve *before* ticket 005 freezes the SDK surface:
if plugins run in a `Worker`, everything crossing the boundary must survive structured clone, which
would rule out the live `Logger` and the class-instance `Credentials` that
`docs/proposals/plugin-sdk-v2.md` sketches into `RunContext`. Under ADR-0004 the SDK surface changes
only deliberately, so getting this wrong is expensive to undo.

Three mechanisms were costed — Bun `Worker`, subprocess (`Bun.spawn`), and in-process — plus the
ticket's explicitly-permitted fourth answer: defer isolation behind an interface, provided the
boundary is designed for it now.

The research was empirical rather than documentary, and two findings reframed the choice.

**The crux — can a hung plugin be killed? — splits.** `terminate()` *does* reliably kill a worker
wedged in a plain `while (true)` loop (CPU 993.9 → 3.6 ms/s, thread confirmed gone), and a worker
contains a `throw`, a floating rejection, `process.exit()` and an infinite loop with the host's event
loop left healthy. But `terminate()` does **not** kill a worker blocked in `Bun.sleepSync` (the thread
survives until the sleep expires) or `Atomics.wait` (the thread never dies and the process never
exits) — and the `node:worker_threads` flavour of `terminate()` returns a Promise that never resolves
in exactly those cases, while the web `Worker` flavour returns `void` and keeps the host responsive.

**Bun itself advises against the pattern.** `Worker` is still documented as experimental,
*"particularly for terminating workers"*, and Bun's stability tracking issue (#15964) recommends
reusing workers rather than creating and destroying temporary ones — which is precisely what a
worker-per-plugin-run isolator does. Around 25 open PRs address use-after-frees between `terminate()`
and in-flight work; plugins `fetch` constantly, so that is the risky path, not an academic one.

Costs, by contrast, were unthreatening: ~1.4 ms worker startup (p50), ~4 MB RSS each, 76 ms to ship a
50,000-song dict, 0.011 ms per awaited RPC round trip. Cost was never the reason to hesitate;
maturity is.

## Decision

### 1. The SDK boundary is designed Worker-shaped from day one

Ticket 005 freezes a surface that is already legal to send across a `postMessage` boundary, whether or
not one exists yet. This is the load-bearing half of the decision: it is cheap now and, under
ADR-0004, ruinous later.

### 2. Phase 1 executes plugins in-process

Behind a strategy seam:

```ts
interface PluginExecutor {
  run(plugin: RegisteredPlugin, payload: RunPayload, deadlineMs: number): Promise<RunResult>;
}
// Phase 1: InProcessExecutor — direct call, try/catch, no clone
// Phase 2: WorkerExecutor    — postMessage; terminate() on deadline breach
```

Three reasons deferral beats adopting Workers immediately:

1. **Bun says so.** Termination — the one capability isolation exists to provide — is the named weak
   spot and is under heavy, largely-unlanded repair.
2. **Phase 1 does not need it.** Every Phase 1 plugin is first-party and reviewed. Isolation earns its
   keep when unreviewed plugins arrive, and third-party install is already out of scope (map).
3. **Keeping the option is nearly free** — and the same constraints buy the subprocess option too,
   since Worker and subprocess boundaries impose *identical* SDK constraints. The mechanism choice
   stays reversible; only the boundary shape is being frozen.

Honesty about what Phase 1 therefore does not have: a `try/catch` around an in-process plugin does
**not** save the host from a floating rejection, a `process.exit()`, an infinite loop, or an OOM. That
is an accepted, reviewed-code-only risk for Phase 1, not an oversight.

### 3. Nine constraints the SDK adopts now, so the later switch is not a breaking change

1. Every `RunContext` **data** field is plain-data cloneable — no class instances, no live handles, no
   `Proxy`.
2. Any context method reaching the host **for an answer** returns `Promise<T>` from day one, even
   though Phase 1 answers synchronously.
3. Fire-and-forget stays `void` — `ctx.log.info()` returns `void` and is never awaited.
4. **No `instanceof` across the boundary.** Errors carry a discriminating `code`; structured clone
   flattens an `Error` subclass's name to `"Error"`, so subclass matching silently stops working.
5. Plugin return values are plain data.
6. No shared mutable state between plugin and host beyond `RunContext`.
7. Every run carries a wall-clock **deadline** in the contract from day one — reported after the fact
   in-process, enforced by `terminate()` in a worker.
8. `configDir` stays a path string, never a handle.
9. Plugins avoid `Bun.sleepSync` and `Atomics.wait` — the two blocking forms `terminate()` cannot
   interrupt.

### 4. `RunPayload` and `RunContext` are separated

`RunContext` is never cloned. Only a plain-data `RunPayload` crosses the boundary, and the SDK harness
on the plugin's side rebuilds a live context around it — so `ctx.log.info()` stays an ordinary
synchronous call and plugin ergonomics are unaffected. Concretely, against the sketch in
`plugin-sdk-v2.md`:

- **`credentials` becomes a plain-data token bag**, with behaviour (`refresh()`) moved to a new async
  `ctx.auth` facade. This is the single most important change, for the reason in §5.
- **`log` is specified as a facade**, reconstructed plugin-side, fire-and-forget, `void`.
- **`runId` and `deadlineMs` are added** — the first to attribute fire-and-forget log lines to a run,
  the second so the timeout contract exists before it is enforced.

The full amended sketch is in the reference doc; ticket 005 owns ratifying it.

### 5. Two machine-checked invariants, not conventions

The genuine hazard here is not that structured clone rejects things — it is that it **silently
accepts** them. A `Logger` class instance clones without error into a method-less husk, so the
sketched context threw `TypeError: ctx.log.info is not a function` deep *inside the plugin*, not at
the boundary. A `bun:sqlite` handle likewise clones into a useless `{filename}`. Nothing in the type
system catches this.

So, per the repo's preference for machine-checked invariants over conventions:

- **`runConformance(plugin)` gains a boundary check** — push the payload and return value through
  `structuredClone()`, fail on `DataCloneError`, **and** assert no field has lost its methods (reject
  any value whose prototype is not `Object.prototype`, `Array.prototype`, or a known cloneable
  builtin). The first half alone would have passed the broken sketch.
- **A lint rule bans `Bun.sleepSync` and `Atomics.wait`** in `packages/plugins`, enforcing constraint 9.

## Alternatives rejected

- **Workers now.** Rejected on maturity, not cost — see Context. Revisited in Phase 2, or sooner if a
  first-party plugin hangs a sync in practice.
- **Subprocess now.** 17.5 ms startup and stronger isolation (it is the only option that can bound
  memory, via OS limits), but it buys resilience Phase 1 does not need at a complexity price. Secrets
  must travel over IPC or stdin — `Bun.spawn`'s `ipc` channel works, and both env and argv were
  verified leaky. Kept as a live option precisely because its SDK constraints are identical.
- **`node:vm` / `isolated-vm` sandboxing.** Rejected outright: `node:vm` is **not** isolation — a
  sandboxed script reached a host env var through the constructor escape — and `isolated-vm` cannot
  load under Bun at all (missing V8 C++ symbol).

## Consequences

- **Ticket 005 is unblocked from this side** (it still waits on 004) and inherits a concrete brief:
  the nine constraints, the `RunPayload`/`RunContext` split, and the amended sketch to ratify.
- **The registry shape is implicated.** A `WorkerExecutor` cannot be a pure runner swap unless plugins
  are loadable *by path* inside a worker; under ADR-0004's explicit registry they are imported modules
  in an array. Ticket 005 must keep a resolvable module path (or a registry-key → path map) alongside
  each entry, or the Phase 2 swap also breaks the frozen registry shape.
- **Memory is the one hole nothing in-runtime closes.** Bun implements no `resourceLimits` on workers
  and enforces no heap cap (3 GB allocated unimpeded). If a hard memory bound is ever required, that
  is the subprocess conversation, not a Worker option.
- **When `WorkerExecutor` lands**, three rules follow from the measurements: use the **web `Worker`**
  API, never `await terminate()`, and prefer a **warm pool** with `terminate()` reserved as the
  deadline escape hatch rather than worker-per-run.
- **Pre-flight checks before that ships** are named in the reference doc's gaps section — chiefly a
  proper soak of terminate-mid-`fetch` (20 clean runs is far too light against ~25 open use-after-free
  PRs) and confirming RSS is actually returned after `terminate()` (111.7 MB of 114.5 MB was retained
  across 20 workers, unchased).
- **If in-process hosting ships in Phase 1**, pin `--unhandled-rejections=strict` rather than relying
  on Bun's undocumented default.
- **All numbers are macOS arm64, one machine, one run.** Linux/Docker is the deployment target and was
  not measured; re-measure inside the production container before quoting them.
