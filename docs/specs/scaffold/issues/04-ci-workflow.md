# 04 — CI workflow

**Status:** resolved

**Spec:** `../spec.md` · **Blocked by:** 01 · **Blocks:** 05 · **Build:** `/implement`

## What to build

A new GitHub Actions workflow beside the v1 ones, per the spec's "CI" decision and user stories
18–22: `pull_request` and `push` to `revival`; the pinned Bun from ticket 01's single source;
frozen-lockfile install; `lint:check`, `format:check`, `type-check`, `cycle-check` and `test` as
separately named steps. No caching or matrix. The `cycle-check` step relies on ticket 02's script.

## Acceptance criteria

- [ ] Triggers and named steps as above; Bun version read from the single pinned source.
- [ ] The v1 workflows are unmodified and still trigger only on `master`.
- [ ] The workflow is syntactically valid (e.g. `actionlint` if available).

## Comments

- 2026-10-15 — Resolved on `revival`; review fixes in 40f52b9. Open items for Cal are in `docs/handoffs/2026-10-15-scaffold.md`.
