# 05 — Verify the gates and update the docs

**Status:** resolved

**Spec:** `../spec.md` · **Blocked by:** 01, 02, 03, 04 · **Blocks:** none · **Build:** `/implement`

## What to build

The spec's `/verify` pass (Testing Decisions, "The config gates are proved by `/verify`") and its
"Docs" decision.

## Acceptance criteria

- [ ] For each of lint, format, type, intra-package cycle and cross-package cycle: a planted
      violation in a scratch package fails the right `check:ci` step, and removing it is green.
- [ ] A type-only intra-package cycle passes; a justified `biome-ignore` suppresses a runtime one.
- [ ] A new directory under `packages/` or `packages/plugins/` with a `package.json` is picked up by
      install, type-check and the cycle checker with no root edit.
- [ ] No scratch package is left behind.
- [ ] `AGENTS.md` § Quality gate is no longer "aspirational"; the roadmap's Phase 0 status line
      records the scaffold; ADR-0014 §10's placement of conventions holds (one-liners in
      `AGENTS.md`, detail in `docs/build-process.md`).
- [ ] A `docs/handoffs/` entry records the pinned Bun version and the verify observations, and a
      `docs/sessions/` entry is written.

## Comments

- 2026-10-15 — Resolved on `revival`; review fixes in 40f52b9. Open items for Cal are in `docs/handoffs/2026-10-15-scaffold.md`.
