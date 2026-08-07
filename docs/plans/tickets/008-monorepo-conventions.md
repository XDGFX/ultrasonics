# 008 — Monorepo conventions

**Status:** ✅ resolved 2026-08-07 (agreed by Cal in session) · **Type:** grilling ·
**Blocked by:** — · **Blocks:** — · **Claimed by:** Cal (wayfinder session, 2026-08-07)

## Question

The conventions the scaffold bakes in, which are cheap now and expensive to change once six
packages exist.

Previously carried as an "open call for the cell" on the old wave board — but a convention every future
package inherits is a decision, not a note. Pulled onto the map so it is settled deliberately.

- **Module file-suffix taxonomy** — adopt `*.interface.ts` / `*.config.ts` / `*.utils.ts` or not?
  The old board's instruction was "propose in the PR, don't impose silently"; this is that
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

## Resolution — 2026-08-07

**A filename suffix earns its keep only when something mechanical reads it** — the rule that decided
the headline question and generalises past this repo.
→ [ADR-0014](../../adr/0014-monorepo-conventions-naming-boundaries-and-gates.md), which carries the
full reasoning, the rejected alternatives and the consequences.

### The one finding that decided the headline question

The suffix taxonomy is admired because of where it is seen working — Angular, NestJS — and in those
ecosystems it is **machine-load-bearing**: the CLI generates on those names and DI resolves by them.
Transplanted to a plain TypeScript monorepo, the identical names are purely descriptive. The visible
pattern travels; the mechanism that justified it does not. That reframed "do we like these suffixes"
into "what reads them", which answers each candidate separately rather than as a package.

Two candidates then fell to repo-specific evidence rather than taste:

- **`*.interface.ts` contradicts an existing convention.** `AGENTS.md` fixes that the TypeScript type
  is inferred from the Zod schema, never hand-declared alongside it — so the interface here *is a
  runtime value*. A type-only file for it would sit empty or invite the duplicate type the
  convention forbids.
- **`*.utils.ts` has this repo's own cautionary tale.** v1's `ultrasonics/tools/` is that folder, and
  it is where [006](006-authprovider-surface.md) found the dead `api_key` proxy that had been
  silently breaking Last.fm for years. It stayed invisible precisely because nobody scans a utility
  bin.

### The questions, answered

1. **Suffix taxonomy**: rejected; `*.test.ts` only. Files named for the concept they hold.
2. **Boundaries** (the replacement for what `.interface.ts` gestured at): the package `exports` field
   is the real boundary, enforced by the resolver. Biome's `noPrivateImports` with `@package` JSDoc
   is left on **as a default, not a wall** — opt-in per symbol and blind to alias imports. Recorded
   at that weaker strength on purpose, per the map's standing caution.
3. **Linter**: Biome, replacing ESLint + Prettier. `.vue` excluded from its scope until
   `packages/web` has files — its SFC support is experimental and does not cover templates.
4. **Cycle gate**: two gates, different scopes. `noImportCycles` (`ignoreTypes: true`) inside a
   package; a workspace dependency-graph script across packages, because Biome's rule is
   project-scoped and expensive. **The `cycle-check:update` rebaseline hatch is retired** — Biome has
   no baseline, so justification moves to per-site suppression comments, which is the better artifact
   anyway. This amends a roadmap-confirmed item.
5. **Test layout**: colocated `*.test.ts`; test *data* in `test/fixtures/` per package.
6. **`.claude/settings.json`**: the deny list carries the weight — it turns
   `docs/agents/issue-tracker.md`'s read-only-issues rule from prose into a check. Deliberately
   restrictive while `revival` might never land; expected to loosen if it becomes the trunk.

### Decided here though not on the ticket

Both matched the ticket's own test — cheap now, expensive once six packages exist — and ADR-0001 left
both open. Agreed in session rather than deferred to the scaffold cell.

7. **One package per plugin**, `packages/plugins/<name>/`, on dependency isolation: a single
   `plugins` package installs every plugin's dependencies for every consumer of any plugin.
8. **Shared base tsconfig, no project references in Phase 0** — Bun never consumes `tsc` build
   output, so references buy incremental compilation we do not need and add a root array that rots
   when a package is added.

### What this hands forward

- **The scaffold cell** — an unambiguous brief; nothing here needs a further decision first.
- **`roadmap.md`** — amended: Phase 0's scaffold brief loses `cycle-check:update` and gains the
  two-gate shape.
- **`AGENTS.md`** — gains the per-session one-liners; **`build-process.md`** takes the operational
  detail, against this ticket's original suggestion that everything land in `AGENTS.md`.

### Deliberately not decided here

- **`eslint-plugin-vue` scoped to `packages/web`** — additive, revisited in Phase 1 with real files.
- **TypeScript project references** — revisited if `tsc --noEmit` becomes slow enough to notice.
- **Loosening the permission allowlist** — tied to whether `revival` becomes the trunk.
