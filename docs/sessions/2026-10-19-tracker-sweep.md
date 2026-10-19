# 2026-10-19 — Tracker sweep

## What changed

- Swept the local tracker. The scaffold issues, the scaffold spec and song-dict issue 01 were done
  but still `ready-for-agent`, because the triage vocabulary had no value for done work. They are
  now `resolved`, and `docs/agents/triage-labels.md` says when to set it.
- Wrote the missing handoff for song-dict issue 01 and added it to the 2026-10-18 session log.

## What's next

- Stale lines found but not yet fixed: `docs/plans/roadmap.md:8, 22, 49–50` and
  `docs/reference/legacy-architecture.md:5` still describe ADR-0006, which ADR-0022 superseded.
- Cal to decide whether Phase 0's "SDK + `AuthProvider` interfaces frozen" needs typed contracts in
  `packages/plugin-sdk` before Phase 0 can close.
- Cal is weighing a move from the local markdown tracker to GitHub Issues.
- Build song-dict issues 02 and 03, then 04.
