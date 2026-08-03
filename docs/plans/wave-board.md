# Wave board

**Status:** Live — Phase 0. No build cell dispatched yet; the decision wave (0.2) is in flight.

Live **execution** state — the single source of truth for *where we are right now*.
`operating-model.md` explains the mechanism; this is the running instance. `handoffs/`+`sessions/`
say what happened; this says what's live and what needs Cal.

What is still *undecided* is not here — that's `map.md` and its `tickets/`. The board tracks work
we know how to do; the map tracks work blocked on an open question.

**Rule:** a cell's status change updates this board in the same commit. A lagging board is worse
than none.

**Concurrency budget: N = 3 concurrent cells.** The rate-limit governor from `operating-model.md`
§2. Cal's to tune — raise after a clean full wave, lower the first time one stalls. Map tickets are
mostly conversation and don't draw on this budget the way build cells do.

**Cell status vocabulary:** `queued` · `in-flight` · `blocked` · `awaiting-Cal` · `merged`.
Waves use the same words: a wave is `queued` until Cal opens it, then `in-flight`.
Checkpoint cells — those touching a checkpoint surface (`operating-model.md` §4) — are marked ⛔
and stop for Cal before landing.

**Branching:** `revival` is the trunk. Sequential engine/docs work commits straight to it; only
parallel fan-out (Phase 2 plugin waves) uses worktree + PR. See `operating-model.md` §2a.

---

## Current phase: 0 — Foundations & operating model

**Next checkpoint:** whichever ⛔ ticket the map's frontier surfaces next, then the Phase 0 exit
gate. Deliberately not named here — see [`map.md`](map.md).

### Wave 0.0 — external lead-time (Cal, non-agent) · **queued**

| Cell | Owner | Status | Notes |
|---|---|---|---|
| Spotify extended-quota application | Cal | queued | ADR-0002 early track; weeks-to-months lead time — start now, in parallel with Phase 0 |
| Apple Developer application | Cal | queued | ADR-0002 early track |

### Wave 0.1 — foundation (serialising) · **queued**

| Cell | Skill | Status | Blocks |
|---|---|---|---|
| Scaffold Bun monorepo + CI (ADR-0001) | /implement | queued | everything downstream |

**Acceptance criteria for the scaffold cell** (adopted from strategic-success's proven tooling):
- **Read-only CI with `:check` variants** — `lint:check` / `format:check` / `type-check` run
  read-only so CI *fails* rather than silently repairing (the mutating `bun run check` is local
  only). Trigger on **both** PRs and direct pushes to `revival`.
- **Import-cycle gate** — a `cycle-check` CI step, with a `cycle-check:update` rebaseline escape
  hatch that must be justified in the commit message. Mechanical anti-slop guard on the dep graph.
- **`.claude/settings.json`** — a scoped permission allowlist (`bun test`/`build`/`check`, `git`,
  `gh`) to cut permission prompts during agent waves.
- **Conventions brief** — the file-suffix taxonomy, linter and test-layout calls come from map
  ticket 008, not from this cell improvising. Resolve 008 first or alongside.

### Wave 0.2 — decisions (map tickets) · **in-flight**

Not build cells — these resolve `map.md` tickets. Mostly HITL with Cal; they don't wait on Wave 0.1
and they don't draw on the concurrency budget the way build cells do.

**→ [`map.md`](map.md) is the only place ticket status lives.** Which tickets exist, what each is
blocked by, and what's on the frontier are not repeated here — a second copy is a second thing to
forget, and this board carried a stale one for exactly as long as it existed.

### Wave 0.3 — core ports (parallel, behind 0.1; max N cells) · **queued**

| Cell | Skill | Status | Notes |
|---|---|---|---|
| Song dict → Zod + tests (ADR-0006) | /tdd | queued | the sacred interchange type |
| Fuzzymatch golden corpus from v1 (ADR-0006) | /research → /tdd | queued | pin v1 output before porting; needs a runnable v1 checkout |

### Phase 0 exit gate

→ [`roadmap.md`](roadmap.md) § Phase 0, which owns every phase gate. Not restated here.

---

## Log

- **2026-08-03** — Board created alongside `operating-model.md`. Phase 0 waves seeded from roadmap;
  nothing dispatched yet. Awaiting Cal to open Wave 0.0 (external applications) and Wave 0.1.
- **2026-08-03** — Folded strategic-success tooling conventions into Wave 0.1 acceptance criteria
  (read-only `:check` CI, import-cycle gate, `.claude/settings.json` allowlist).
- **2026-08-03** — **Deduplication audit.** Cal found ticket state spread across all four planning
  docs. This board's Wave 0.2 table and `operating-model.md` §6 both held their own copy of the map's
  ticket list, and both had gone stale within a day (010 and 002 shown open after closing; 012 and
  013 absent). The Phase 0 exit gate existed in three files; the map's Out-of-scope section restated
  `roadmap.md`'s Deferred list. All copies removed in favour of links, and `operating-model.md` §3
  now states the no-copies rule explicitly with the ownership boundaries named.
- **2026-08-03** — Wayfinder review of the Phase 0 plan. Added `map.md` + 9 decision tickets;
  split the old "freeze SDK + AuthProvider" cell into tickets 001–007; inserted the missing
  account-model and schema decisions; moved decisions out of this board into the map
  (new Wave 0.2), renumbering the core ports to Wave 0.3. `system-command` dropped; Subsonic moved
  to Phase 3; PR policy relaxed to parallel-work-only (`operating-model.md` §2a).
