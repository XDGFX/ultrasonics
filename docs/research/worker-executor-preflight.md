# Research: `WorkerExecutor` pre-flight checks

**Date:** 2026-11-16
**Informs:** Phase 2's "adopt `WorkerExecutor`" (`docs/plans/roadmap.md`)
**Builds on:** ADR-0010, and the gaps section of `docs/reference/plugin-isolation-research.md`
**Versions:** Bun **1.4.2** (the repo's `packageManager` pin; 1.4.3 shipped 2026-10-10) on macOS 25.6
arm64, and `oven/bun:1.4.2` (Debian 13) under OrbStack on Linux arm64 (kernel 7.2) and, emulated
through Rosetta, linux/amd64
**Harnesses:** `packages/core/experiment/worker-preflight/` on the branch
`research/worker-executor-preflight`, with every raw CSV and JSON result in its `results/`

## 1. Question

ADR-0010 deferred `Worker` isolation to Phase 2, and the research behind it named three checks that
must pass before `WorkerExecutor` ships:

1. a soak of `terminate()` while a worker is mid-`fetch` (20 clean runs was far too light against the
   use-after-free PRs then open);
2. whether RSS comes back after `terminate()` (111.7 of 114.5 MB stayed resident across 20 workers);
3. the same numbers on Linux in Docker, the deployment target.

Does `WorkerExecutor` pass on today's Bun, and on what terms?

## 2. Summary

**Go, with mitigations.** None of the three checks failed.

- **Terminate mid-`fetch` is clean.** 37,000 workers on macOS and 37,000 on Linux arm64, plus 10,000
  emulated on amd64, were killed mid-request against a server that never answers and one that
  streams forever. No crash, no uncaught error, no leaked socket or file descriptor. Every one of
  those sockets closed on the server side. `terminate()` returned in a p99 of under 0.21 ms.
- **Memory plateaus and is given back.** Over 5,000 runs of the real Plex plugin, worker-per-run RSS
  levels off: about 130 MB on Linux, flat across the second half (−0.3 MB per 100 runs), and back to
  65 MB within 30 s of idle. macOS holds on to more (about 200 MB, creeping 0.45 MB per 100 runs, and
  only partly returned), which is the allocator rather than a leak: Linux, the target, returns it.
- **Costs are small next to the network a run does.** A fresh worker that imports the Plex plugin and
  runs it costs about 35–44 ms more than in-process. A warm worker costs about 1 ms more. A
  10,000-song playlist takes about 12 ms to cross the boundary each way.
- **Two things changed since Bun 1.3.13.** A worker blocked in `Atomics.wait` now dies on
  `terminate()`. `Bun.sleepSync` still does not die until the sleep ends.
- **The executor seam needs one change.** `PluginExecutor.run` receives the loaded `Plugin`, and the
  registry's `path` (`@ultrasonics/plugin-plex`) does not resolve from `packages/core` or
  `packages/server` under Bun's isolated installs. It only resolves from `packages/registry`.

## 3. Method

All harnesses run outside `bun run test`: none is named `*.test.ts`. Each Linux run copies the repo
into a fresh `oven/bun:1.4.2` container and runs `bun install --frozen-lockfile` there
(`in-docker.sh`). The OrbStack VM had 12 cores. Each measurement runs in its own process, so every
baseline starts cold. RSS is sampled after `Bun.gc(true)`. File descriptors are counted from
`/dev/fd` on macOS and `/proc/self/fd` on Linux.

- **`soak-fetch.ts`**: a child process serves two raw TCP endpoints. One accepts the connection and
  never answers. The other sends chunked headers, then 1 KB every 10 ms, forever. The child also
  counts open sockets. Each cycle spawns a web `Worker` (`ref: false`) that posts `in-flight` once it
  is inside the request. For the streaming endpoint that is after the first body chunk. The host then
  waits a random 0–20 ms and calls `terminate()`. Cycles alternate between the two endpoints. Every
  50 cycles the harness records RSS, the host's descriptor count and the server's open-socket count.
  After the soak, a 3 s settle, then the host must spawn a fresh worker and get a reply. Runs were
  sequential (`parallel=1`, 5,000 cycles) and in bursts of 16 (`parallel=16`, 2,000 cycles, 32,000
  workers).
- **`memory.ts`**: `plugin-worker.ts` is a minimal prototype of the `WorkerExecutor` plugin side. It
  loads the plugin by path, rebuilds the context with the SDK's own `createRunContext`, and answers
  `credentials()` over `postMessage` (ADR-0010 §4). Each run is a real Plex output: 20 songs from
  the recorded library, appended to one playlist on the Plex package's own `fake-plex.ts`, which runs
  in a child process. All 20 match, so every run makes the full set of library, search and playlist
  requests. Five modes, each 1,000 runs, plus 5,000-run repeats of the two that matter:
  - `per-run`: worker-per-run;
  - `per-run-smol`: the same with `{ smol: true }`;
  - `kill-mid-run`: `terminate()` 0–15 ms into a run, which lands during the plugin's dynamic import
    or its first requests;
  - `warm`: one reused worker;
  - `in-process`: today's `InProcessExecutor`.

  After the loop the harness idles for 30 s, sampling at 1 s, 6 s and 30 s.
- **`cost.ts`**: spawn to first message for a bare worker and for the SDK harness; a whole Plex run
  fresh, warm and in-process; 10,000 `postMessage` round trips; and a 10,000-song playlist (2.5 MB as
  JSON) through `structuredClone` and through a worker and back. It also records RSS with 20 live
  workers that have each loaded and run Plex.
- **`crux.ts`**: re-runs the research doc's `terminate()` table on 1.4.2, one child process per case.

## 4. Terminate mid-`fetch`

| | macOS arm64 | Linux arm64 (Docker) | Linux amd64 (emulated) |
|---|---|---|---|
| Workers terminated mid-request, sequential | 5,000 | 5,000 | 2,000 |
| Workers terminated mid-request, bursts of 16 | 32,000 | 32,000 | 8,000 |
| Crashes / uncaught errors | 0 / 0 | 0 / 0 | 0 / 0 |
| `terminate()` return, sequential p50 · p99 · max | 0.014 · 0.082 · 4.8 ms | 0.042 · 0.204 · 10.6 ms | 0.041 · 0.106 · 1.2 ms |
| `terminate()` return, bursts p50 · p99 · max | 0.004 · 0.015 · 0.15 ms | 0.008 · 0.159 · 5.5 ms | 0.006 · 0.044 · 3.5 ms |
| Host loop lag, `setTimeout(0)`, p99 · max (sequential) | 6.2 · 11.3 ms | 5.1 · 17.0 ms | 4.8 · 17.8 ms |
| Host descriptors, start → end | 8 → 8 | 13 → 13 | 16 → 16 |
| Server sockets still open at the end | 0 | 0 | 0 |
| Healthy afterwards (new worker replies) | yes | yes | yes |
| Host RSS, sequential: start → end | 17.5 → 57 MB | 22.9 → 44.9 MB | 46 → 124 MB |
| Host RSS, bursts: start → end | 17.7 → 465 MB | 22.7 → 80 MB | 46 → 177 MB |

On macOS, 16 of every 5,000 terminations landed before the connection reached the server, so the
soak covers mid-connect as well as mid-response. On Linux every connection landed.

Descriptor counts never moved, and every server-side socket closed, so `terminate()` cancels the
request on Bun's shared HTTP thread rather than orphaning it. The burst RSS on macOS rose fast, then
crept: 301 MB after 800 workers, 445 MB after 8,000, 465 MB after 32,000. On Linux the same burst
soak peaked near 110 MB and ended at 80. The macOS figure is allocator retention, not something
Linux reproduces.

This is a release build, not ASAN. The earlier gap asked for "a few thousand iterations under ASAN
or at least in CI". This covers the second half at roughly ten times that count, on both
architectures, but it cannot see a use-after-free that happens not to crash.

## 5. Memory over many runs

RSS in MB, sampled after a forced GC (baseline is after one warm-up run in the host):

| Mode (runs) | Platform | Baseline | Peak | Mean, last 10 samples | After 30 s idle | Second-half growth per 100 runs |
|---|---|---|---|---|---|---|
| per-run (5,000) | Linux arm64 | 59.1 | 160.6 | 130.7 | **64.7** | −0.29 |
| per-run (5,000) | macOS | 52.2 | 201.6 | 201.3 | 91.5 | +0.45 |
| per-run (1,000) | Linux arm64 | 59.5 | 160.2 | 139.2 | 72.0 | −0.54 |
| per-run (1,000) | macOS | 51.3 | 162.1 | 92.2 | 37.8 | −5.43 |
| per-run-smol (1,000) | Linux arm64 | 59.4 | 146.1 | 128.7 | 65.4 | +1.05 |
| per-run-smol (1,000) | macOS | 49.6 | 157.4 | 111.0 | 37.9 | +2.26 |
| kill-mid-run (1,000) | Linux arm64 | 58.2 | 156.4 | 133.4 | 69.7 | −0.22 |
| kill-mid-run (1,000) | macOS | 49.2 | 164.0 | 130.4 | 39.5 | −0.97 |
| warm (5,000) | Linux arm64 | 57.8 | 129.5 | 113.3 | 64.5 | −0.05 |
| warm (5,000) | macOS | 53.3 | 130.5 | 130.5 | 131.2 | +0.06 |
| in-process (1,000) | Linux arm64 | 59.7 | 95.8 | 84.1 | 72.3 | +0.88 |
| in-process (1,000) | macOS | 53.6 | 108.3 | 107.2 | 108.2 | +3.71 |

No run failed in any mode.

- **No unbounded growth in any mode on Linux.** Worker-per-run levels off about 70 MB above
  baseline, sawtooths between 120 and 140 MB for 5,000 runs, and comes back to within 6 MB of
  baseline once idle. The ~1,000-worker test the research doc asked for passes: worker-per-run is not
  wrong on memory grounds.
- **macOS keeps more and gives it back unpredictably.** Some runs drop to baseline on idle, while
  the 5,000-run series kept 91 MB. The macOS per-run 5,000 series still creeps at +0.45 MB per
  100 runs at the end. That would be about 45 MB over 10,000 runs, and Linux shows none of it. Treat
  macOS RSS as a development curiosity, not a capacity figure.
- **`smol` buys little.** Its peak is 4–14 MB lower and its p90 latency is higher. It is not worth
  defaulting.
- **Even in-process grows.** A plugin that runs in the host costs 25–55 MB of heap that never
  returns on macOS. Some of every plateau above is the work, not the worker.

Chart-ready data:
`packages/core/experiment/worker-preflight/results/memory-combined.csv`, with columns `platform`,
`mode`, `cycles`, `cycle` and `rss_mb`. It has a row every 10 runs, and `idle+1s`, `idle+6s` and
`idle+30s` rows at the end of each series. The per-run file for each series is beside it, and the
soak CSVs (RSS, descriptors and open sockets every 50 cycles) are named `*-soak-fetch-p1.csv` and
`*-soak-fetch-p16.csv`. The p16 CSVs hold the 2,000-cycle runs.

## 6. Cost against in-process

| Measure | macOS arm64 | Linux arm64 |
|---|---|---|
| Bare worker, construct → first message, p50 · p90 | 0.37 · 0.64 ms | 0.92 · 2.37 ms |
| SDK harness worker ready (imports the SDK and Zod), p50 · p90 | 17.7 · 27.2 ms | 21.5 · 43.7 ms |
| Plex run, fresh worker (spawn + import plugin + run), p50 · p90 | 34.6 · 77.1 ms | 43.9 · 56.5 ms |
| Plex run, warm worker, p50 · p90 | 8.7 · 26.8 ms | 7.5 · 10.8 ms |
| Plex run, in-process, p50 · p90 | 7.8 · 27.5 ms | 7.0 · 12.6 ms |
| `postMessage` round trip, p50 · p99 (in-process `await`: ~0) | 0.009 · 0.026 ms | 0.024 · 0.046 ms |
| 10,000-song playlist, `structuredClone`, p50 | 10.1 ms | 9.9 ms |
| 10,000-song playlist, host → worker → host, p50 | 23.8 ms | 27.3 ms |
| RSS per live worker that has loaded and run Plex | ~12 MB | ~15 MB |
| RSS 2 s after terminating those 20 workers | not returned (494.6 MB) | returned (442 → 131.6 MB) |

The bare spawn is about four times faster than 1.3.13's 1.4 ms. The real per-run price is module
loading: each fresh worker re-evaluates the SDK, Zod, the matcher and the plugin. That is about
35 ms per run, against Plex runs that spend their time on a real server, and Spotify runs that page
through an API. The boundary itself costs about 1 ms for a run's worth of messages and about 12 ms
each way for a 10,000-song playlist. Neither matters.

## 7. The `terminate()` table on Bun 1.4.2

| Worker blocked in | Web `Worker.terminate()` | Process exits | Same on 1.3.13? |
|---|---|---|---|
| `while (true) {}` | returns `undefined` in <1 ms, thread dies | at once (~70 ms incl. boot) | yes |
| `Bun.sleepSync(8000)` | returns at once; **thread lives until the sleep ends** | after 8.0 s | yes |
| `Atomics.wait` (no timeout) | returns at once, **thread dies** | at once | **no**: it used to never exit |
| `node:worker_threads` `terminate()` on a spin | Promise resolves | — | yes |
| `node:worker_threads` `terminate()` on `sleepSync` | **Promise still pending after 2 s** | after 8.0 s | yes |

Both platforms agree. The host loop stayed responsive in every case: a 10 ms timer fired in 10–12 ms.
ADR-0010's rules stand: use the web `Worker`, never await `terminate()`, and keep the lint ban on
`Bun.sleepSync`. `Atomics.wait` is now killable, but keep it banned. It is no use to a plugin, and
the change is undocumented.

## 8. The other open gaps

- **`bun build --compile` with workers (#15981, closed).** Still broken unless the worker is
  bundled: `new Worker(new URL("./worker.ts", import.meta.url))` fails in a compiled binary with
  `ModuleNotFound resolving "/$bunfs/root/worker.ts"`. Passing the worker as a second entry point
  (`bun build --compile host.ts worker.ts`) works. The fix PR, #36286, was closed unmerged. This
  matters only if `packages/cli` is compiled, and then every plugin entry would need bundling too.
- **Comlink.** Not needed. The prototype in `plugin-worker.ts` is about 50 lines of plain
  `postMessage` and covers the whole `HostPort`.
- **The `ref` default.** The 1.4.2 docs still describe `ref: false` as the opt-out. Pass it
  explicitly, as the harnesses do.
- **Wasm, OOM failure mode, ASAN.** Not tested. Wasm is still open upstream (§9). OOM was out of
  scope for machine safety. An ASAN build was not to hand.
- **Plugin path resolution (new).** The runner hands the executor a loaded `Plugin`
  (`PluginExecutor.run(plugin, …)`). The registry's `path` is a bare specifier. Under the workspace's
  isolated installs it resolves only from `packages/registry`:
  `import.meta.resolve("@ultrasonics/plugin-plex")` throws from `packages/core` and
  `packages/server`. A `WorkerExecutor` therefore needs the registry entry, resolved to a file URL
  where it is declared, not the `Plugin` object. That is a change to core's internal executor
  interface, not to the SDK.

## 9. Upstream status

Checked with `gh api` on 2026-11-16.

- **The Workers page at `bun-v1.4.2` still says** *"The `Worker` API is still experimental
  (particularly for terminating workers)"*.
- **The tracking and race issues the research cited are closed as completed.** #15964 (stability
  tracking), #34690 (ASAN `!exception()` on terminate), #33936 (transpile racing `terminate()`) and
  #32073 (generation tokens) were all closed in one batch on 2026-08-08, before 1.4.0. #32082, the
  generation-token change, merged on 2026-06-12. But #33939 and #32071, the fix PRs named on #33936
  and #32082, were closed **unmerged**. "Closed" therefore does not prove those races are fixed.
  This soak is the evidence, not the tracker.
- **Still open, and relevant:**
  - #44216: `terminate()` lets a busy worker keep running JavaScript for tens to hundreds of
    milliseconds.
  - #45252: `terminate()` during an N-API addon load aborts the whole process.
  - #44886 and #46669: Wasm. A terminated worker keeps running, or leaks a thread spinning at
    100% CPU.
  - #34917: no heap cap honoured, so memory-limited containers OOM.
  - PR #36356, which would let `terminate()` pre-empt a pure-Wasm loop, was closed unmerged.
- **#31771** (linear RSS growth from retained module records) is closed. Its last comment says it is
  still valid and points to #36815. The Linux plateau above shows no sign of it for worker churn.

## 10. Recommendation

**Go with mitigations.** Worker termination was the reason for the deferral, and on Bun 1.4.2 it
survived about 84,000 mid-request kills across two architectures with nothing leaked. Memory under
worker churn is bounded on Linux and returned when idle. The costs are tens of milliseconds a run.
The mitigations:

1. **Worker-per-run is acceptable. Reuse a worker only within one account.** The soak removes the
   memory argument for a warm pool. A pool shared across accounts would share module state between
   tenants, against constraint 6 and the multi-tenancy boundary. If the ~35 ms spawn-and-import
   ever matters, pool per `(account, plugin)` and recycle on any deadline breach or error. This
   reverses ADR-0010's "prefer a warm pool", so it needs a superseding note in an ADR, and Cal's
   call: it touches multi-tenancy.
2. **Keep ADR-0010's API rules.** Use the web `Worker` with an explicit `ref`, never await
   `terminate()`, and keep the lint ban on `Bun.sleepSync` and `Atomics.wait`.
3. **Assume a terminated worker can still act for a moment** (#44216). After a deadline breach,
   mark the stage failed at once and ignore late messages from that worker. Output plugins must
   already tolerate a write that half-happened.
4. **Pass the resolved plugin path, not the `Plugin`, to `WorkerExecutor`.** Resolve the registry
   entry with `import.meta.resolve` in `packages/registry`, where the specifier resolves, and carry
   it on the entry.
5. **Bound concurrency and memory outside the runtime.** At 12–15 MB per live loaded worker, cap
   concurrent plugin workers. The run queue serialises only per applet, so different applets
   still run at once. Give the
   container a memory limit with a restart policy. Bun still cannot cap a worker's heap (#34917).
6. **Ban native addons and Wasm in plugins for now** (#45252, #44886, #46669). Neither is used
   today. Add both to plugin review, and to the lint rule if it can see them.
7. **Make the soak a gate on Bun upgrades.** Run `soak-fetch.ts` and `memory.ts per-run 5000` in
   `oven/bun:<new version>` before each bump of the `packageManager` pin (1.4.3 is already out).
   Fail if any socket or descriptor survives or the second-half growth exceeds 1 MB per 100 runs.
   An ASAN run is worth adding there if one becomes easy to get.
8. **If `packages/cli` is ever compiled**, bundle the worker entry and each plugin as extra entry
   points (#15981, §8).

**Confidence.** High for the leak and crash results on release builds of 1.4.2 on arm64, and on
amd64 under emulation. Medium for absolute timings and RSS on amd64, which are emulated and not
for quoting. No ASAN build was run, so a use-after-free that does not crash would go unseen. All
numbers are from one machine.
