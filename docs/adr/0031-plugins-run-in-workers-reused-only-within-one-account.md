# ADR-0031 — Plugins run in workers, and a worker is reused only within one account

**Status:** Accepted (Cal, 2026-11-16)
**Date:** 2026-11-16
**Supersedes:** ADR-0010's "prefer a **warm pool**" consequence. The rest of ADR-0010 stands.
**Evidence:** [`docs/research/worker-executor-preflight.md`](../research/worker-executor-preflight.md),
on Bun 1.4.2, macOS arm64 and Linux in Docker
**Spec:** [Spec: adopt WorkerExecutor](https://github.com/XDGFX/ultrasonics/issues/210)

## Context

ADR-0010 ran plugins in-process for Phase 1 and deferred `Worker` isolation until three pre-flight
checks passed: a soak of `terminate()` mid-`fetch`, whether memory comes back after `terminate()`,
and the same on Linux in Docker. All three passed on Bun 1.4.2 (research §4–5). About 84,000 workers
were killed mid-request with no crash and no leaked socket or descriptor, and worker-per-run memory
levels off on Linux and is returned when idle.

ADR-0010 also said to prefer a warm pool over worker-per-run, following Bun's advice to reuse
workers. Its reason was maturity. Since the soak covers that, the pool's remaining effect is to keep
one plugin's module state alive across runs. If those runs belong to different accounts, that is
shared state across the tenant boundary, against constraint 6 and ADR-0003.

## Decision

**Phase 2 runs every plugin handler through a `WorkerExecutor`, one web `Worker` per call, with the
research's mitigations (§10).** A worker is only ever reused within one account, never across
accounts. Worker-per-call meets that rule trivially, and is what ships. If the ~35 ms of spawn and
import ever matters, a pool keyed by account and plugin may follow, and it recycles a worker on any
deadline breach or error.

The mitigations:

1. **Late messages are ignored.** Once a call settles, by its result, its deadline or a crash, the
   executor drops anything more that worker sends. `terminate()` can leave a busy worker running for
   a moment (#44216), so the stage fails at the deadline whether or not the worker has stopped.
2. **Concurrent workers are capped.** A call waits for a free slot. Each live worker that has loaded
   a plugin costs 12–15 MB, and the run queue serialises only per applet.
3. **The container has a memory limit,** set and explained in `compose.yaml`, with a restart policy.
   Bun cannot cap a worker's heap (#34917).
4. **No native add-ons and no Wasm in plugins** (#45252, #44886, #46669). Lint and a workspace check
   enforce what they can see, and plugin review covers the rest.
5. **ADR-0010's API rules stand:** the web `Worker` with an explicit `ref`, never an awaited
   `terminate()`, and the lint ban on `Bun.sleepSync` and `Atomics.wait`.
6. **The soak gates every Bun upgrade,** as `docs/build-process.md` § Upgrading Bun describes.

**The executor is given the plugin's resolved module path, not the loaded `Plugin`** (research §8).
The registry's bare specifiers resolve only from `packages/registry` under isolated installs, so the
registry resolves each one to a file URL where it is declared. `PluginExecutor` is internal to core;
the plugin SDK's contract does not change.

## Considered options

- **A warm pool shared by every account.** It is cheapest, but one account's run could see module
  state another account's run left behind. Rejected.
- **Worker-per-run only, forbidding any pool.** Rejected as more than the boundary needs. A pool
  inside one account shares nothing a tenant could not already see.
- **Stay in-process.** ADR-0010's reasons for waiting were Bun's maturity and an all-reviewed plugin
  set. The first is answered by the soak, and ten more ported plugins weaken the second.
- **A subprocess per run.** It can bound memory through the OS, but costs more to start and carries
  secrets over IPC (ADR-0010). The container's memory limit is enough for Phase 2.

## Consequences

- A plugin cannot keep state across runs in module scope. A fresh worker sees fresh modules, so any
  state that must last goes in `configDir`.
- A deadline breach becomes a stage failure that names the deadline, where Phase 1 only warned after
  the fact (ADR-0010 constraint 7).
- An out-of-memory plugin still takes the whole process down. The container restarts, and boot marks
  the run `interrupted` (ADR-0018 §4).
- A compiled `packages/cli` would have to bundle the worker entry and every plugin as extra entry
  points (#15981, research §8).
- Connection tests (`test()`) still run in the server's process. ADR-0010's seam covers run handlers
  only.
