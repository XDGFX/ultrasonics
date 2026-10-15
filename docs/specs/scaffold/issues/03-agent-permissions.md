# 03 — Agent permission allowlist

**Status:** ready-for-agent

**Spec:** `../spec.md` · **Blocked by:** none · **Blocks:** 05 · **Build:** `/implement`

## What to build

`.claude/settings.json` with exactly the allow and deny lists in ADR-0014 §9 and
`docs/build-process.md`, per the spec's "Agent permissions" decision and user stories 23–25.

## Acceptance criteria

- [ ] The allow and deny lists match ADR-0014 §9 exactly; verified by inspection.
- [ ] Deny entries cover flag-reordered and option-prefixed variants wherever the settings syntax
      allows it.
- [ ] `.claude/worktrees/` stays out of git.

## Comments

- 2026-10-15 — Resolved on `revival`; review fixes in 40f52b9. Open items for Cal are in `docs/handoffs/2026-10-15-scaffold.md`.
