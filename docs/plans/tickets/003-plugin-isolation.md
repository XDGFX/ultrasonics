# 003 — Plugin isolation mechanism

**Status:** ✅ Closed 2026-08-03 · **Type:** research (AFK) · **Blocked by:** — · **Blocks:** 005 ·
**Claimed by:** Claude (wayfinder session 2026-08-03) ·
**Resolution:** [ADR-0010](../../adr/0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md),
evidence in [`reference/plugin-isolation-research.md`](../../reference/plugin-isolation-research.md)

## Question

How are plugins isolated at runtime — Bun `Worker`, subprocess, or in-process — and what does the
chosen mechanism demand of the SDK boundary?

ADR-0001 wants isolation so one bad plugin cannot crash a sync. `plugin-sdk-v2.md` lists this as an
open question. It is **not** an SDK detail: if plugins run in a Worker, everything crossing the
boundary must be structured-cloneable, which rules out passing a live `Logger`, an open database
handle, or a class instance in `RunContext` — and `RunContext` is exactly what 005 freezes. Decide
this *before* the surface, not after.

## What to establish

- What Bun's `Worker` support can actually do today: module loading, npm deps inside a worker,
  memory/lifetime cost per worker, and whether a hung worker can be terminated cleanly.
- Whether structured-clone constraints are tolerable for `RunContext` as sketched, or force an
  RPC-shaped boundary (`log()` becomes a message, not a function).
- The cost of the alternatives: subprocess (heavier, stronger isolation, harder credential passing)
  vs in-process (free, no isolation, one `throw` from a plugin author kills the run).
- Whether isolation can be deferred behind an interface that keeps 005 honest without paying for it
  in Phase 1 — a legitimate answer, if the boundary is designed for it now.

## Notes

This is an AFK ticket: resolve with a `/research` subagent against Bun's documentation and real
behaviour, and record cited findings. It needs no live conversation, which is why it sits on the
frontier alongside the HITL tickets — run it in parallel with them.

---

## Resolution — 2026-08-03

**Design the boundary Worker-shaped now; run in-process in Phase 1; adopt a `WorkerExecutor` in
Phase 2.** The ticket's fourth option — defer isolation behind an interface — is not a compromise
here, it is the evidenced answer. Full decision in
[ADR-0010](../../adr/0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md); measured
evidence (Bun 1.3.13, macOS arm64) in
[`reference/plugin-isolation-research.md`](../../reference/plugin-isolation-research.md).

Answering the four things this ticket set out to establish:

- **Bun `Worker` capability.** Workers load ESM/TS directly, use npm deps and builtins, cost ~1.4 ms
  to start and ~4 MB RSS, and contain a `throw`, a floating rejection, `process.exit()` and an
  infinite loop with the host healthy. **But the crux splits:** `terminate()` kills a plain
  `while(true)` worker, and does *not* kill one blocked in `Bun.sleepSync` or `Atomics.wait` (there,
  the thread never dies and the process never exits). Bun still documents `Worker` as experimental
  *"particularly for terminating workers"*, and issue #15964 advises against the
  create-and-terminate-per-task pattern a per-run isolator wants. **Maturity, not cost, is the
  blocker.**
- **Structured clone.** Smaller than this ticket assumed, but nastier in shape. `RunContext` should
  never be cloned — only a plain-data `RunPayload` crosses, and the harness rebuilds a live context
  plugin-side, so **`log()` stays a normal synchronous call** and no RPC-shaped ergonomics penalty
  lands on plugin authors. The real hazard is silence: a class instance clones *without error* into a
  method-less husk, so the sketched `RunContext` threw `TypeError: ctx.log.info is not a function`
  inside the plugin rather than at the boundary.
- **The alternatives.** Subprocess: 17.5 ms startup, the only option that can bound memory, secrets
  must go via IPC (env and argv both verified leaky) — and **identical SDK constraints**, which is why
  the mechanism choice stays reversible. In-process: `try/catch` does **not** save you from a floating
  rejection, `process.exit()`, an infinite loop, or an OOM. `node:vm` is not isolation at all (escaped
  to the host realm via the constructor trick) and `isolated-vm` cannot load under Bun.
- **Deferral.** Yes — at the price of nine day-one SDK constraints (ADR-0010 §3), of which four cost
  real ergonomics now: plain-data-only context fields, async-typed host calls, `code`-discriminated
  errors rather than an `instanceof` hierarchy, and a wall-clock deadline in the contract from day
  one.

### What this hands ticket 005

1. The nine constraints, and the `RunPayload` / `RunContext` split to ratify.
2. Four concrete amendments to the `plugin-sdk-v2.md` sketch: `credentials` becomes plain data with
   behaviour moved to a new async `ctx.auth` facade; `log` is specified as a reconstructed
   fire-and-forget facade; `runId` and `deadlineMs` are added.
3. **A registry-shape constraint 005 must not miss:** a `WorkerExecutor` is only a pure runner swap if
   plugins are loadable *by path* inside a worker. Under ADR-0004's explicit registry they are
   imported modules in an array, so 005 must keep a resolvable module path (or a key → path map)
   alongside each entry — otherwise the Phase 2 swap breaks the registry it froze.
4. Two machine-checked invariants to carry into the conformance suite: a `structuredClone()` boundary
   check that *also* asserts no field lost its methods, and a lint rule banning `Bun.sleepSync` and
   `Atomics.wait` in `packages/plugins`.
