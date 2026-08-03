# 008 — Monorepo conventions

**Status:** Open · **Type:** grilling · **Blocked by:** — · **Blocks:** — · **Claimed by:** —

## Question

The conventions the scaffold bakes in, which are cheap now and expensive to change once six
packages exist.

Previously carried as an "open call for the cell" on the wave board — but a convention every future
package inherits is a decision, not a note. Pulled onto the map so it is settled deliberately.

- **Module file-suffix taxonomy** — adopt `*.interface.ts` / `*.config.ts` / `*.utils.ts` or not?
  The wave board's instruction was "propose in the PR, don't impose silently"; this is that
  proposal, made once rather than per-package.
- **Import-cycle gate** — confirmed as a CI step with a `cycle-check:update` rebaseline escape
  hatch that must be justified in the commit message. Which tool?
- **Read-only `:check` CI variants** — `lint:check` / `format:check` / `type-check` fail rather
  than silently repair; mutating `bun run check` stays local. Confirmed; decide the linter
  (Biome vs ESLint+Prettier — Bun-native matters).
- **Test layout** — colocated `*.test.ts` or a `test/` directory per package.
- **`.claude/settings.json`** permission allowlist scope, so agent waves are not prompt-storms.

## A good resolution

Written into `AGENTS.md` (conventions) so every later cell inherits them without asking, and the
scaffold cell has an unambiguous brief. Small enough that it can ride along with the scaffold if
Cal prefers — but decided, not improvised mid-PR.
