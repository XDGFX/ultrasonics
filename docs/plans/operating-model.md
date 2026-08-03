# Development operating model

How the revival is actually built: the factory manual. `roadmap.md` says *what* to build and in
what order; this says *how* the work gets dispatched, kept honest, and kept visible. It is the last
unbuilt piece of **Phase 0** — "build the factory, not the product".

The model in one line: **human-gated waves of parallel work-cells, each cell a fixed
skill-driven pipeline, all state on one board.** Cal opens each wave; agents run the cells; gates
stop the slop; the board means nobody gets lost.

---

## 1. The work-cell — the atom of all work

Every unit of work, from "port fuzzymatch" to "port the Deezer plugin", is a **cell**. A cell is
one deliverable, one worktree, one PR, run through the **same** pipeline. Learn the cell once and a
wave of ten is just the cell ten times.

```
(ambiguous?) → /research ──▶ docs/specs/<feature>.md ──▶ /grill-with-docs (freeze the spec)
            ──▶ worktree ──▶ /tdd  or  /implement ──▶ /verify
            ──▶ /code-review ──▶ /improve-codebase-architecture (anti-slop gate)
            ──▶ draft PR ──▶ docs/handoffs/ + docs/sessions/
```

**Stage rules**

- **/research** — run *only* when the spec would otherwise rest on a guess (an external API's real
  behaviour, an ambiguous v1 detail). Its output is cited notes the spec can lean on. Skip when the
  contract is already unambiguous.
- **docs/specs/ entry** — the contract. Per AGENTS.md, **no PR merges without its spec**. If there
  is no spec, the cell isn't ready; writing it is the first move, not code.
- **/grill-with-docs** — freezes the spec by stress-testing its open questions. Mandatory for any
  cell touching a checkpoint surface (§4); optional for a routine port against a frozen contract.
- **/tdd vs /implement** — `/tdd` (red-green-refactor) is the default for anything with correctness
  stakes: fuzzymatch, the runner, plugin I/O, auth. `/implement` is for scaffolding and wiring where
  tests follow rather than lead. When in doubt, `/tdd`.
- **/verify** — the cell must be shown *running*, not just green in tests. This is the roadmap's
  literal exit-gate language ("a real Spotify playlist syncs to Plex through the UI").
- **/code-review + /improve-codebase-architecture** — the two anti-slop gates. Review catches bugs;
  the architecture pass catches the AI-generated sludge that passes tests but rots the codebase.
  Both must pass. **Red is "don't ask for review"** (AGENTS.md quality gate).
- **handoff + session log** — written when the cell closes *or* the agent runs low on context, so
  the next agent resumes cold. Non-negotiable; it's what makes waves survivable.

A cell is **done** when its PR is green on the full package suite, both anti-slop gates passed,
`/verify` observed the behaviour, and its spec's acceptance criteria are ticked.

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
4. **Place the checkpoints.** Any cell touching a §4 surface stops for Cal *before* it merges.
   Phase boundaries are always a checkpoint.

Dispatch is **human-gated**: Cal opens each wave deliberately. This is a rate-limit decision as
much as a control one — automated or scheduled fan-out would cheerfully blow the ceiling. Each cell
runs as a background job in its own worktree and ends at a draft PR.

## 3. The board — so nobody gets lost

`docs/plans/wave-board.md` is the single source of truth for *live* state: the current wave, every
cell and its status (`queued` / `in-flight` / `blocked` / `awaiting-Cal` / `merged`), what each is
blocked on, and the next checkpoint. It is the index over the raw material in `handoffs/` and
`sessions/` — those say *what happened*; the board says *where we are right now*.

Rule: **a cell's status change updates the board in the same PR.** A board that lags is worse than
no board. If you can't tell from the board what needs Cal, the wave has already lost cohesion.

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

**Wave 0.0 — external lead-time (Cal, non-agent, start immediately).** File the Spotify
extended-quota and Apple Developer applications (ADR-0002 early parallel track). Real lead time;
kick off before anything else so it's ticking in the background.

**Wave 0.1 — the foundation cell (serialising; must land first).** Scaffold the Bun monorepo and CI
per ADR-0001 — factory only, no product code. Everything downstream needs the `packages/*` skeleton
and a green empty pipeline. One cell, `/implement`, no checkpoint beyond the phase gate.

**Wave 0.2 — contracts + core (parallel behind 0.1, rate-limited to N cells).**
- *SDK + AuthProvider freeze* — `/grill-with-docs` the `plugin-sdk-v2.md` open questions →
  freeze both typed contracts. **Checkpoint (SDK contract + auth).** Blocks all plugin work.
- *Song dict → Zod + tests* — `/tdd`. The sacred interchange type (ADR-0006).
- *Fuzzymatch golden corpus* — generate the golden test corpus from a v1 checkout (ADR-0006), so
  the port is pinned to v1 output before a line of it is written.

**Phase 0 exit gate** (from roadmap): CI green on an empty pipeline · SDK + `AuthProvider` frozen ·
song-dict Zod schema + tests merged · docs + ADRs in place. → opens **Phase 1**, the vertical slice.

---

*Owner: this doc is living (`plans/`). Amend as the factory teaches us where it creaks.*
