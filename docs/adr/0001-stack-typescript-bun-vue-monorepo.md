# ADR-0001 — Stack: TypeScript / Bun / Vue in a monorepo

**Status:** Accepted
**Date:** 2026-07-28

## Context

ultrasonics v1 is a Python 3 / Flask / Flask-SocketIO app with a jQuery + server-rendered
frontend, ~1,200 LOC of engine plus ~15 plugins. It has been dormant for years. The revival is a
rewrite, not a patch: the domain logic (song dict, fuzzymatch, applet/plugin model) is small and
portable, while the pain (dead auth proxy, `ast.literal_eval` storage, deprecated
`fuzzywuzzy`/`python-Levenshtein` needing a C++ toolchain, Flask/SocketIO) is incidental 2020
plumbing worth deleting rather than modernising. The owner works in TypeScript/Bun with Vue
frontends, and the goal is a codebase AI agents can develop autonomously — which favours strong
types and testability.

## Decision

Rewrite ultrasonics as a **Bun-workspaces monorepo in TypeScript (strict)**, Vue 3 + Vite
frontend, Zod for validation. Package layout:

- `packages/core` — song dict (Zod), applet runner, fuzzymatch + golden tests.
- `packages/plugin-sdk` — `definePlugin()`, handshake/settings types, auth helpers (ADR-0004).
- `packages/plugins` — the official plugins, one folder each, isolated.
- `packages/server` — Bun HTTP API + WebSocket run-logs, scheduler, persistence (ADR-0003).
- `packages/web` — Vue 3 SPA (applet builder, run history, settings).
- `packages/cli` — headless applet runner for cron/homelab; also the basis for the future home
  agent (A2, ADR-0002).

The web UI is a client of the server API, not a separate engine. The CLI runs applets without a
browser.

## Consequences

- v1's Python plugins do not carry over; each is re-implemented against the new SDK (Phase 2,
  `docs/plans/roadmap.md`). This is the bulk of the work and is why the AI-agent workflow matters.
- Deprecated native deps disappear with the language; `fuzzywuzzy`'s behaviour is reproduced in
  TS and pinned with golden tests (ADR-0006).
- Existing users have a v1 SQLite database; a one-time importer is required (see roadmap Phase 1).
- Tooling standardises on `bun test` / `bun run check`; `AGENTS.md` owns the gate.
