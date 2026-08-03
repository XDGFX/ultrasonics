# Wave board

**Status:** Live — Phase 0, nothing dispatched yet.

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

**Next checkpoint:** ✅ the account model (map ticket 001) is **decided** — ADR-0007. That freed
ticket 006 and put 010 (how a hosted account authenticates) on the frontier, which now gates the
schema. Next checkpoint: 010, then the Phase 0 exit gate.

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

### Wave 0.2 — decisions (map tickets) · **queued**

Not build cells — these resolve `map.md` tickets. Mostly HITL with Cal; they don't wait on Wave 0.1.

| Ticket | Type | Status | Notes |
|---|---|---|---|
| ⛔ 001 Account model | grilling | ✅ **done** | ADR-0007 · "tenant" retired; freed 006, surfaced 010 + 011 |
| 003 Plugin isolation mechanism | research | queued | **frontier** · AFK; constrains the SDK boundary |
| 004 Trigger model + runner OR semantics | grilling | queued | **frontier** · fixes v1's accidental AND |
| 008 Monorepo conventions | grilling | queued | **frontier** · feeds Wave 0.1 |
| 009 Triage v1 issue backlog | task | queued | **frontier** · AFK draft, Cal applies public changes |
| ⛔ 002 Account-scoped database schema | grilling | blocked | by 010 · the unretrofittable one |
| ⛔ 005 Plugin SDK surface freeze | grilling | blocked | by 003, 004 · blocks all plugin work |
| ⛔ 006 AuthProvider surface freeze | grilling | queued | **frontier** · unblocked by 001 · grill `proposals/auth-provider-v2.md` |
| ⛔ 010 How a hosted account authenticates | grilling | queued | **frontier** · gates 002's `accounts` columns |
| 011 Self-host first run + auth-mode config | grilling | blocked | by 010 · graduated from map fog |
| 007 Builder-time credentials | grilling | blocked | by 005, 006 · may legitimately defer past Phase 1 |

### Wave 0.3 — core ports (parallel, behind 0.1; max N cells) · **queued**

| Cell | Skill | Status | Notes |
|---|---|---|---|
| Song dict → Zod + tests (ADR-0006) | /tdd | queued | the sacred interchange type |
| Fuzzymatch golden corpus from v1 (ADR-0006) | /research → /tdd | queued | pin v1 output before porting; needs a runnable v1 checkout |

### Phase 0 exit gate

CI green on empty pipeline · SDK + AuthProvider frozen · account model + schema ADR'd · trigger
model settled · song-dict Zod + tests merged · docs + ADRs in place · **`map.md` has no open
tickets**. → opens **Phase 1 — vertical slice**.

---

## Log

- **2026-08-03** — Board created alongside `operating-model.md`. Phase 0 waves seeded from roadmap;
  nothing dispatched yet. Awaiting Cal to open Wave 0.0 (external applications) and Wave 0.1.
- **2026-08-03** — Folded strategic-success tooling conventions into Wave 0.1 acceptance criteria
  (read-only `:check` CI, import-cycle gate, `.claude/settings.json` allowlist).
- **2026-08-03** — Wayfinder review of the Phase 0 plan. Added `map.md` + 9 decision tickets;
  split the old "freeze SDK + AuthProvider" cell into tickets 001–007; inserted the missing
  account-model and schema decisions; moved decisions out of this board into the map
  (new Wave 0.2), renumbering the core ports to Wave 0.3. `system-command` dropped; Subsonic moved
  to Phase 3; PR policy relaxed to parallel-work-only (`operating-model.md` §2a).
