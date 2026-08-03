# Session — 2026-08-03 — Map ticket 003: plugin isolation

Participants: Claude (Opus 5), AFK — no live human. Branch:
`worktree-wayfinder-003-plugin-isolation`, based on `revival` @ 72209a9.

## What happened

`/wayfinder` invoked against the ultrasonics map with no ticket named, so the session picked one.
Ticket **002 (account schema)** is first in frontier order but was already being resolved on a
concurrent worktree — so it was skipped as claimed, and has since landed as ADR-0009. Of the rest,
**003** was the only ticket both on the frontier and **AFK**, which matters for a background session
with no human to grill. Claimed and resolved it.

Resolved with a `/research` subagent per the ticket's own instruction. Bun **1.3.13** happened to be
installed, so most findings are **measured on this machine**, not merely cited — throwaway probe
scripts ran outside the repo and are not committed.

## Decision

**Design the SDK boundary Worker-shaped now; execute in-process in Phase 1; adopt a `WorkerExecutor`
in Phase 2**, behind a `PluginExecutor` seam.
→ [ADR-0010](../adr/0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md).

The ticket had already flagged deferral as a legitimate answer. The evidence made it the *right* one —
but for a reason the ticket did not anticipate.

**What actually decided it was maturity, not cost.** Bun's docs still label `Worker` experimental
*"particularly for terminating workers"*, and Bun's own tracking issue (#15964) advises against the
create-and-terminate-per-task pattern a per-run isolator wants, with ~25 open PRs fixing
terminate-vs-in-flight use-after-frees. Plugins `fetch` constantly, so that is the exposed path.
Costs were never the obstacle: ~1.4 ms worker startup, ~4 MB RSS, 76 ms for a 50,000-song dict,
0.011 ms per awaited RPC.

**The crux question split.** `terminate()` *does* kill a worker in a plain `while(true)` (CPU
993.9 → 3.6 ms/s). It does **not** kill one blocked in `Bun.sleepSync` or `Atomics.wait` — there the
thread never dies and the process never exits — and `node:worker_threads`' `terminate()` returns a
Promise that never resolves in those cases, while the web `Worker` one stays responsive.

**Structured clone was smaller than feared but nastier in shape.** `RunContext` should never be
cloned; only a plain-data `RunPayload` crosses and the harness rebuilds a live context plugin-side, so
`ctx.log.info()` stays an ordinary synchronous call — no RPC ergonomics penalty for plugin authors.
The real hazard is silence: a class instance clones **without error** into a method-less husk, so the
sketched context threw `TypeError: ctx.log.info is not a function` deep inside the plugin rather than
at the boundary. Nothing in the type system catches that, which is why it became a conformance check
rather than a convention.

Also established: `node:vm` is **not** isolation (escaped to the host realm via the constructor
trick), `isolated-vm` cannot load under Bun at all, subprocess imposes *identical* SDK constraints
(so the mechanism choice stays reversible), and in-process `try/catch` does not save the host from a
floating rejection, `process.exit()`, an infinite loop, or an OOM.

## Artifacts

- **`docs/adr/0010-…`** — the decision. Numbered 0010 because the concurrent ticket-002 work took
  0009.
- **`docs/reference/plugin-isolation-research.md`** — 655 lines of cited and measured findings, with
  the amended `RunContext` sketch, the nine day-one constraints, and a confidence-and-gaps section.
- **`tickets/003`** closed with its resolution and an explicit "what this hands 005" section.
- **`tickets/005`** unblocked from 003's side and re-briefed — it inherits a ratification job, not an
  open design question.
- **`map.md`**, **`plugin-sdk-v2.md`** updated.

## What Cal should look at

1. **ADR-0010 is `Status: Proposed`** and 003 is not a ⛔ checkpoint ticket — but its constraints land
   squarely on the SDK contract, which *is* one. Worth an explicit accept before 005 runs.
2. **Constraints 1, 2, 4 and 7 cost real ergonomics now** (plain-data-only fields, async signatures
   with no async work behind them, `code`-discriminated errors instead of an error hierarchy, a
   deadline in the contract before anything enforces it). That price is the whole trade — it buys a
   non-breaking Phase 2 switch. If Cal would rather pay later, this is the decision to push back on.
3. **All numbers are macOS arm64, one machine.** Linux/Docker is the deployment target and was not
   measured.

## Next concrete steps

1. **004 (trigger model)** is now the single ticket between the map and the SDK freeze — the
   highest-leverage HITL ticket on the frontier. It needs Cal.
2. **009 (issue triage)** is the remaining AFK ticket and can run unattended in parallel.
3. **013 (v1 importer shape)** graduated from the fog when 002 closed and is also on the frontier.

## Note on branching

Per `AGENTS.md`, sequential work commits directly to `revival`; PRs are reserved for parallel
fan-out. This ran in a worktree only because the session was a background job required to isolate,
then rebased onto `revival` and merged fast-forward — no PR. The rebase was not mechanical: ticket
002 landed first and restructured the planning docs (folding away `operating-model.md` and
`wave-board.md`, tightening the map's conventions), so the map entries here were rewritten to the
new terser house style rather than merged as originally written.
