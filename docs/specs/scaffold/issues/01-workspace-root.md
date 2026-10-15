# 01 — Workspace root, Bun pin, TypeScript and Biome

**Status:** ready-for-agent

**Spec:** `../spec.md` · **Blocked by:** none · **Blocks:** 02, 04, 05 · **Build:** `/implement`

## What to build

The root of the factory: a private root `package.json` with workspaces `packages/*` and
`packages/plugins/*`; the Bun version pinned in one source that `oven-sh/setup-bun` can also read;
the committed `bun.lock`; the base and root TypeScript configurations; `biome.json`; the root
`.gitignore` extended for Bun/Node artefacts (v1 entries kept); and the scripts `check`,
`check:ci`, `lint:check`, `format:check`, `type-check` and `test`. `check:ci` gains `cycle-check`
in ticket 02.

Every decision is already in the spec's Implementation Decisions (Workspace, Bun version,
TypeScript, Biome, Scripts) and ADR-0014. The v1 tree is untouched and excluded from every gate.

## Acceptance criteria

- [ ] `bun install` on a clean clone succeeds and leaves the lockfile unchanged.
- [ ] `bun run check:ci` (without `cycle-check`) and `bun run test` pass with zero packages.
- [ ] `noImportCycles` (`ignoreTypes: true`) and `noPrivateImports` are on. If either is missing
      or renamed in the current Biome release, stop and escalate (spec, Further Notes).
- [ ] `.vue` and every v1 path are outside Biome's and tsc's scope.
- [ ] Nothing under the v1 tree is modified.

## Comments

- 2026-10-15 — Resolved on `revival`; review fixes in 40f52b9. Open items for Cal are in `docs/handoffs/2026-10-15-scaffold.md`.
