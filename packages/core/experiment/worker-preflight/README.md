# WorkerExecutor pre-flight harnesses

Throwaway experiments behind `docs/research/worker-executor-preflight.md`. None is named `*.test.ts`,
so `bun run test` never runs them. Run from this directory on the host, or through `in-docker.sh`
from the repo root for Linux (`PLATFORM=linux/amd64` for an emulated x86 run).

| Script | What it measures |
|---|---|
| `soak-fetch.ts [cycles] [parallel]` | `terminate()` mid-`fetch` against a server that never answers and one that streams forever: terminate latency, host loop lag, fds, sockets left open server-side |
| `memory.ts <mode> [cycles]` | RSS across Plex output runs: `per-run`, `per-run-smol`, `kill-mid-run`, `warm`, `in-process` |
| `cost.ts` | Spawn latency, whole-run latency, message round trip, a 10,000-song playlist across the boundary, RSS per live worker |
| `crux.ts` | Re-checks the research doc's `terminate()` table: spin, `Bun.sleepSync`, `Atomics.wait`, and the `node:worker_threads` Promise |

`plugin-worker.ts` is a minimal prototype of the `WorkerExecutor` plugin side: it loads a plugin by
path, rebuilds the context with `createRunContext`, and answers `credentials()` over `postMessage`.
Raw output (CSV and JSON) lands in `results/`, named by platform and Bun version.
