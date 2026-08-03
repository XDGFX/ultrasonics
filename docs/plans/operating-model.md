# Development operating model

**Status:** Living — the Phase 0 factory manual; amend as the factory teaches us where it creaks.

How the revival is actually built: the factory manual. `roadmap.md` says *what* to build and in
what order; this says *how* the work gets dispatched, kept honest, and kept visible. It is the last
unbuilt piece of **Phase 0** — "build the factory, not the product".

The model in one line: **human-gated waves of parallel work-cells, each cell a fixed
skill-driven pipeline, all state on one board.** Cal opens each wave; agents run the cells; gates
stop the slop; the board means nobody gets lost.

---

## 1. The work-cell — the atom of all work

Every unit of work, from "port fuzzymatch" to "port the Deezer plugin", is a **cell**. A cell is
one deliverable run through the **same** pipeline. Learn the cell once and a wave of ten is just
the cell ten times.

```
(ambiguous?) → /research ──▶ docs/specs/<feature>.md ──▶ /grill-with-docs (freeze the spec)
            ──▶ worktree ──▶ /tdd  or  /implement ──▶ /verify
            ──▶ /code-review ──▶ /improve-codebase-architecture (anti-slop gate)
            ──▶ land on revival (PR only if parallel — §2a)
            ──▶ docs/handoffs/ + docs/sessions/
```

**Stage rules**

- **/research** — run *only* when the spec would otherwise rest on a guess (an external API's real
  behaviour, an ambiguous v1 detail). Its output is cited notes the spec can lean on. Skip when the
  contract is already unambiguous.
- **docs/specs/ entry** — the contract. Per AGENTS.md, **no PR merges without its spec**. If there
  is no spec, the cell isn't ready; writing it is the first move, not code.
- **/grill-with-docs** — freezes the spec by stress-testing its open questions. Mandatory for any
  cell touching a checkpoint surface (§4). Skip it **only when a frozen spec already covers the
  cell** (e.g. a routine plugin port against the frozen SDK contract + conformance test) — never
  because the cell "seems simple". No spec, frozen or fresh, means no merge (AGENTS.md).
- **/tdd vs /implement** — `/tdd` (red-green-refactor) is the default for anything with correctness
  stakes: fuzzymatch, the runner, plugin I/O, auth. `/implement` is for scaffolding and wiring where
  tests follow rather than lead. When in doubt, `/tdd`.
- **/verify** — the cell must be shown *running*, not just green in tests. This is the roadmap's
  literal exit-gate language ("a real Spotify playlist syncs to Plex through the UI").
- **/code-review + /improve-codebase-architecture** — the two anti-slop gates. Review catches bugs;
  the architecture pass catches the AI-generated sludge that passes tests but rots the codebase.
  Both must pass. **Red is "don't ask for review"** (AGENTS.md quality gate).
- **handoff + session log** — `/handoff`, written when the cell closes *or* the agent runs low on
  context, so the next agent resumes cold. Non-negotiable; it's what makes waves survivable.

A cell is **done** when it is green on the full package suite, both anti-slop gates passed,
`/verify` observed the behaviour, and its spec's acceptance criteria are ticked.

**Cell sizing.** One deliverable, one decision's worth of scope. Agent sessions are 1M tokens, so
context is rarely the binding constraint — *reviewability* is. Split a cell when it would resolve
two independent decisions (as ticket 005 was split from 003 and 004 on `map.md`), not merely when
it looks long. Conversely, don't split work that shares one contract across three cells just to
look parallel; the coordination costs more than the concurrency wins.

## 2. Waves — how a phase becomes parallel work

A **wave** is a batch of cells Cal dispatches together. Composing one:

1. **Slice the phase into cells.** One deliverable each; independently reviewable; own worktree.
2. **Draw the dependency edges.** Sequential only where correctness demands it (contracts before
   the things that depend on them; the vertical slice before any fan-out). Everything else runs in
   parallel.
3. **Size to the rate-limit budget, not the dependency graph.** This is the real governor. A phase
   can be embarrassingly parallel and still only run **N concurrent cells** — N set by the token /
   rate ceiling, not by how many cells are theoretically independent. A wide phase drains as
   several batches of N, not one giant fan-out. Undersized beats throttled-and-stalled.
   **N is recorded on the board** (`wave-board.md`, "Concurrency budget") and is Cal's to tune —
   never guessed per-wave. Starting value **N = 3**; raise it once a full wave has run without
   hitting limits, lower it the first time one stalls.
4. **Place the checkpoints.** Any cell touching a §4 surface stops for Cal *before* it merges.
   Phase boundaries are always a checkpoint.

Dispatch is **human-gated**: Cal opens each wave deliberately. This is a rate-limit decision as
much as a control one — automated or scheduled fan-out would cheerfully blow the ceiling. Each cell
runs as a background job.

## 2a. Branching — `revival` is the trunk, PRs are optional

`revival` is a **working branch, not production**. Nothing is deployed from it and no user runs it,
so the ceremony that protects a release branch is pure friction here. There is no `master` merge
until v2 is real (roadmap Phase 4).

**The rule: PRs when work is parallel, direct commits when it isn't.**

- **Direct to `revival`** — engine and core development, scaffolding, docs, anything sequential.
  These start from zero, there is no prior art to conflict with, and Cal does not need to review
  every commit of a rewrite in progress. Commit and push; the board and session log are the record.
- **Worktree + PR** — the fan-out case, chiefly Phase 2's one-agent-per-plugin waves. Here a PR
  earns its keep: it isolates a plugin's work from nine siblings touching the same package tree, it
  gives CI a per-plugin verdict, and it leaves a legible per-plugin record. Merged by the agent
  once green and both anti-slop gates pass — no review wait.
- **⛔ Checkpoint cells** stop for Cal *before* landing, whichever mechanism they used. That is the
  control gate; the PR is not.

Rejected alternative: PR-for-everything. It reads as rigour but on a pre-release trunk it only
buys queueing latency and a review backlog Cal has said they don't want.

## 3. The board and the map — so nobody gets lost

Two live documents, and the split between them is the point:

- **`wave-board.md` — the board.** *Live execution state.* The current wave, every cell and its
  status (`queued` / `in-flight` / `blocked` / `awaiting-Cal` / `merged`), what each is blocked on,
  and the next checkpoint. Index over the raw material in `handoffs/` and `sessions/` — those say
  *what happened*; the board says *where we are right now*.
- **`map.md` — the wayfinder map.** *What is still undecided.* Decision tickets in `tickets/`, one
  question each, with their blocking edges, plus the fog (**Not yet specified**) and the explicit
  **Out of scope**. The board tracks work you know how to do; the map tracks work you can't start
  because a question is open.

A thing belongs to exactly one of them. If you find yourself writing a decision onto the board, it
was a ticket; if you find yourself tracking build progress on the map, it was a cell.

**No copies — link instead.** This rule is stated twice because it was broken three times: the board
and §6 of this document both grew their own copy of the map's ticket list, and the Phase 0 exit gate
was written out in three files. Every copy was stale within a day of a ticket closing, and a stale
copy is worse than a link because it looks authoritative. Concretely:

- **Ticket existence, status, blocking and the frontier live only in `map.md`.** No other file lists
  them. Naming *one* ticket as the source of a constraint ("the conventions brief comes from ticket
  008") is a pointer and is fine; reproducing the list is not.
- **Phase gates live only in `roadmap.md`.**
- **Cell status lives only in `wave-board.md`.**

If you want a reader to see one of those, link to it. Summarising it *is* copying it.

Rule: **a cell's status change updates the board in the same commit**, and a resolved ticket
updates the map in the same commit that closes it. A board that lags is worse than no board — this
is the known failure mode of a markdown tracker, and the only defence is the discipline. If you
can't tell from the board what needs Cal, the wave has already lost cohesion.

## 4. Checkpoint surfaces — when a cell stops for Cal

Straight from AGENTS.md. A cell escalates rather than guesses when it touches:

- the **auth layer** (`AuthProvider`, credential storage, OAuth flows),
- the **plugin SDK contract** (the shape every plugin depends on),
- the **database schema** or any migration,
- **multi-tenancy / security** boundaries,
- anything a spec left **genuinely ambiguous**.

Everything else — a routine port with green CI and clean review — proceeds without a checkpoint.
Phase boundaries are always a checkpoint.

## 5. Skill → gate map

Quality is a step that must pass, not a hope. Each skill is pinned to the gate it owns.

| Gate | Skill | Fails the cell if… |
|---|---|---|
| Ambiguity resolved | `/research` | the spec would otherwise rest on a guess |
| Contract frozen | `/grill-with-docs` | a checkpoint-surface spec still has open questions |
| Correctness | `/tdd` | behaviour isn't pinned by tests written first |
| It actually runs | `/verify` | the change was never exercised end-to-end |
| No bugs | `/code-review` | review surfaces an unaddressed correctness issue |
| No slop | `/improve-codebase-architecture` | the code passes tests but degrades the architecture |

---

## 6. First waves (Phase 0 → Phase 1 entry)

Concrete application of the model to the roadmap's remaining Phase 0 work. Kept here as the worked
example; live status lives on the board.

Phase 0 is now explicitly **two kinds of work in parallel**: decisions (map tickets) and build
(cells). The decisions gate the build, not the other way round — which is why Wave 0.2 comes before
Wave 0.3 despite 0.3 looking like the "real" work.

**Wave 0.0 — external lead-time (Cal, non-agent, start immediately).** File the Spotify
extended-quota and Apple Developer applications (ADR-0002 early parallel track). Approval lead time
is the one dependency engineering speed cannot compress; kick off before anything else so it's
ticking in the background.

**Wave 0.1 — the foundation cell (serialising; must land first).** Scaffold the Bun monorepo and CI
per ADR-0001 — factory only, no product code. Everything downstream needs the `packages/*` skeleton
and a green empty pipeline. One cell, `/implement`, no checkpoint beyond the phase gate. Its
conventions brief comes from map ticket 008.

**Wave 0.2 — the decision wave (map tickets; mostly HITL, runs alongside 0.1).** Resolve
`map.md`'s frontier, in the order the map gives. These are *conversations and research*, not builds,
so they don't wait on the scaffold and don't consume the concurrency budget the same way. The
tickets themselves are **not listed here** — `map.md` is the only copy, per §3.

**Wave 0.3 — core ports (parallel behind 0.1, rate-limited to N cells).** Pure build work; needs no
open decision.
- *Song dict → Zod + tests* — `/tdd`. The sacred interchange type (ADR-0006).
- *Fuzzymatch golden corpus* — generate the golden test corpus from a v1 checkout (ADR-0006), so
  the port is pinned to v1 output before a line of it is written. Keep a runnable v1 checkout
  around long enough to produce it.

**Phase 0 exit gate** — `roadmap.md` owns it; not restated here.

---

*Owner: this doc is living (`plans/`). Amend as the factory teaches us where it creaks.*
