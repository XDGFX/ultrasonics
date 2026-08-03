# Wave board

Live state — the single source of truth for *where we are right now*. `operating-model.md` explains
the mechanism; this is the running instance. `handoffs/`+`sessions/` say what happened; this says
what's live and what needs Cal.

**Rule:** a cell's status change updates this board in the same PR. A lagging board is worse than none.

Status: `queued` · `in-flight` · `blocked` · `awaiting-Cal` · `merged`
Checkpoint cells (§4 surfaces) are marked ⛔ — they stop for Cal before merge.

---

## Current phase: 0 — Foundations & operating model

**Next checkpoint:** SDK + AuthProvider contract freeze (Wave 0.2), then the Phase 0 exit gate.

### Wave 0.0 — external lead-time (Cal, non-agent) · **queued**

| Cell | Owner | Status | Notes |
|---|---|---|---|
| Spotify extended-quota application | Cal | queued | ADR-0002 early track; real lead time — start ASAP |
| Apple Developer application | Cal | queued | ADR-0002 early track |

### Wave 0.1 — foundation (serialising) · **not dispatched**

| Cell | Skill | Status | Blocks |
|---|---|---|---|
| Scaffold Bun monorepo + CI (ADR-0001) | /implement | queued | everything downstream |

### Wave 0.2 — contracts + core (parallel, behind 0.1; rate-limited) · **not dispatched**

| Cell | Skill | Status | Notes |
|---|---|---|---|
| ⛔ Freeze plugin SDK + AuthProvider contracts | /grill-with-docs | queued | blocks all plugin work; checkpoint |
| Song dict → Zod + tests (ADR-0006) | /tdd | queued | the sacred interchange type |
| Fuzzymatch golden corpus from v1 (ADR-0006) | /research → /tdd | queued | pin v1 output before porting |

### Phase 0 exit gate

CI green on empty pipeline · SDK + AuthProvider frozen · song-dict Zod + tests merged · docs + ADRs
in place. → opens **Phase 1 — vertical slice**.

---

## Log

- **2026-08-03** — Board created alongside `operating-model.md`. Phase 0 waves seeded from roadmap;
  nothing dispatched yet. Awaiting Cal to open Wave 0.0 (external applications) and Wave 0.1.
