# ADR-0014 — Monorepo conventions: naming, boundaries and gates

**Status:** Proposed
**Date:** 2026-08-07
**Refines:** ADR-0001 (which fixed the stack and package layout but left naming, plugin packaging
and the TypeScript config strategy open)
**Ticket:** [`docs/plans/tickets/008-monorepo-conventions.md`](../plans/tickets/008-monorepo-conventions.md)
**Amends:** [`docs/plans/roadmap.md`](../plans/roadmap.md) § Phase 0, whose scaffold brief recorded a
`cycle-check:update` rebaseline hatch that §4 below retires.

## Context

ADR-0001 fixed the stack — Bun workspaces, TypeScript strict, Vue 3, Zod — and named six packages.
It did not settle how files inside them are named, how module boundaries are enforced, which linter
runs, where tests sit, whether each plugin is its own package, or how `tsconfig` is structured.

Those are cheap to decide with zero packages on disk and expensive once six exist, which is why they
were pulled onto the decision map rather than left to the scaffold cell to improvise. The roadmap
already says as much: *"Conventions — the file-suffix taxonomy, linter and test-layout calls come
from map ticket 008, not from the scaffold cell improvising."*

Two constraints from elsewhere in the repo do real work below. `AGENTS.md` fixes that **the
TypeScript type is inferred from the Zod schema, never hand-declared alongside it** — which turns out
to decide the `*.interface.ts` question outright. And Cal's standing principle that anything which
must always hold gets a check rather than a convention sets the bar every item here is judged
against.

## Decision

### 1. No file-suffix taxonomy, and the rule that generalises

**A filename suffix earns its keep only when something mechanical reads it.** That sorts candidates
into three tiers:

1. **Machine-load-bearing** — a runner, bundler or framework keys on the name (`*.test.ts`,
   `vite.config.ts`, `drizzle.config.ts`). Always adopt.
2. **Glob-targetable, where the glob actually exists** — CI or a lint rule genuinely selects on it.
   A speculative glob does not count.
3. **Purely descriptive** — the suffix is a comment in the filename. Nothing checks it, so it drifts,
   and a stale suffix is worse than none because it is read as authoritative.

**We adopt `*.test.ts` and nothing else.** Files are named for the concept they hold
(`song-dict.ts`, `applet-runner.ts`).

Rejected specifically:

- **`*.interface.ts`** — tier 3, and it contradicts an existing convention. Because types are
  inferred from Zod schemas, the interface in this codebase **is a runtime value**. A type-only
  `.interface.ts` file would either sit empty or invite exactly the hand-declared duplicate type
  `AGENTS.md` forbids.
- **`*.utils.ts`** — tier 3, and the only candidate with no cohesion criterion: "utils" names the
  absence of a decision about where something belongs, so it accretes monotonically. The in-repo
  evidence is v1's `ultrasonics/tools/`, which is where ticket 006 found the dead `api_key` proxy
  that had been silently breaking Last.fm for years. It stayed invisible because nobody scans a
  utility bin.
- **`*.config.ts`** as a general pattern — real config files already self-name because their tools
  demand it. Applying the suffix to application config modules adds nothing.

**Why the taxonomy looks better than it is.** Angular and NestJS make it work because the framework
consumes the names — the CLI generates on them and DI resolves by them. There the suffix is tier 1.
Transplanted to a plain TypeScript monorepo the same names drop to tier 3: the visible pattern
travels, the mechanism that justified it does not.

There is also a design cost. A suffix taxonomy categorises by *kind of file*, which is layering at
file granularity: it pulls one concept's parts into separate files and makes shallow modules cheap to
create. That runs against the deep-module discipline this codebase wants if agents are to navigate it.

### 2. Module boundaries are enforced, not described

Rejecting the taxonomy must not cost the legible public surface `*.interface.ts` gestures at. Two
layers provide it, and **they are deliberately recorded at different strengths**:

- **Package boundary — the `exports` field** in each package's `package.json`. This is the real
  boundary: enforced by the module resolver itself, so it cannot be ignored or suppressed. Anything
  not exported is unreachable from another package.
- **Within a package — Biome's `noPrivateImports`**, with internals marked `@package` in JSDoc. This
  is a helpful default we leave on. It is **not** a wall: visibility is opt-in per symbol, and the
  rule does not currently apply to path-alias imports.

The asymmetry is stated on purpose. A later session must not mistake the lint rule for a guarantee —
the map carries a standing caution about precisely that kind of hardening, and this ADR would rather
record the weaker claim.

### 3. Biome, for lint and format

**Biome replaces ESLint and Prettier.** One binary, no Node service to keep alive, lint and format in
one tool, and roughly 25–35× ESLint's speed — which matters here because lint latency is paid on
every cell of every agent wave. It also brings the cycle rule in §4 into a tool already running.

The known gap is Vue. Biome's SFC support exists but is explicitly experimental and does not fully
cover templates, which is `eslint-plugin-vue`'s territory. **`.vue` is excluded from Biome's scope
for now**: `packages/web` has no files until Phase 1, `vue-tsc` catches type errors in SFCs
regardless, and enabling an experimental parser against zero files buys nothing that could be
evaluated. Adding a minimal `eslint-plugin-vue` scoped to `packages/web` remains available and is
purely additive.

### 4. Two import-cycle gates, and no rebaseline file

The gate is confirmed; the shape changes.

- **Inside a package** — Biome's `noImportCycles`, with `ignoreTypes: true`, since type-only imports
  vanish at runtime and cannot cycle.
- **Across packages** — a small script over the workspace dependency graph in each `package.json`.
  Biome's rule is documented as project-scoped and computationally expensive, so it is not trusted to
  catch `@ultrasonics/core` ↔ `@ultrasonics/server`. The script is instant and deterministic, and
  package-level cycles are the ones that actually hurt.

**The `cycle-check:update` rebaseline hatch is retired.** Biome has no baseline mechanism, so the
escape hatch becomes a per-site `// biome-ignore lint/…/noImportCycles: <justification>` comment.
This is a better artifact than the baseline it replaces: the justification sits at the cycle rather
than in a blob, and it appears in the diff where a reviewer will see it. The roadmap recorded the
rebaseline hatch as confirmed, so this amends it deliberately rather than quietly.

### 5. Test layout: colocated, with fixtures apart

`*.test.ts` sits beside the code it tests. `bun:test` discovers either layout, so this is ergonomics —
and colocation means one directory listing shows a unit and its tests together, which matters more
than usual because agents navigate by reading directories and a split layout doubles the lookups.

**Test *data* goes in `test/fixtures/` per package.** The fuzzymatch golden corpus (ADR-0006) and the
v1 importer's sample databases are data, not code, and colocating them would bury the source files.

### 6. One package per plugin

`packages/plugins/<name>/`, each with its own `package.json`. ADR-0001's "one folder each, isolated"
is read as one *package* each.

The argument that wins it is dependency isolation: a single `plugins` package installs every plugin's
dependencies for every consumer of any plugin, and would undercut ADR-0010's Worker-shaped boundary.
It also matches how `AGENTS.md` says Phase 2's one-agent-per-plugin waves are dispatched — a worktree
and a PR per unit — by giving each wave a package-sized unit and CI a per-unit verdict. The cost is
~15 more `package.json` files and a slightly larger graph for §4's script to walk, which is cheap.

### 7. Shared base tsconfig, no project references in Phase 0

A root `tsconfig.base.json` extended by each package. **TypeScript project references are not
adopted yet.**

References are the standard answer for TypeScript monorepos and would add a third boundary-enforcing
layer agreeing with §2 and §4. But Bun transpiles directly and never consumes `tsc` build output, so
references buy incremental compilation we do not need, while adding a root `references` array that
rots silently whenever a package is added. Revisit if `tsc --noEmit` becomes slow enough to notice;
retrofitting is annoying but bounded.

### 8. Scripts

- `bun run check` — `biome check --write` + `tsc --noEmit` (plus `vue-tsc` once `packages/web`
  exists). Mutating; local only.
- `bun run check:ci` — the read-only `:check` variants (`lint:check`, `format:check`, `type-check`)
  plus `cycle-check`. Fails rather than repairs, per the roadmap's Phase 0 brief.

### 9. `.claude/settings.json` — the deny list is the point

Allow: `bun test`, `bun run build`, `bun run check`, the `:check` variants, `bun install`; `git`
`status`/`diff`/`log`/`add`/`commit`/`branch`/`checkout`/`worktree`; and read-only `gh` —
`issue view`, `issue list`, `pr view`, `pr list`.

Deny: `gh issue comment|close|edit|label`, `gh pr comment|merge`, `git push --force`, and any push to
`master`.

The denials carry the weight. `docs/agents/issue-tracker.md` makes the 40+ real user issues on the
public repo **read-only evidence, never a work queue** — a rule that until now existed only as prose.
The deny entries make it machine-checked. The scope is deliberately restrictive while `revival` might
never land: the cost of an agent touching a stranger's issue thread is unrecoverable, and the cost of
a permission prompt is a keystroke. This is expected to loosen if and when `revival` becomes the
trunk and issues move to GitHub properly.

### 10. Where these are written

Split, against the ticket's own suggestion that everything land in `AGENTS.md`. That file states
explicitly that conditionally-useful material is *"deliberately kept out of this file so it stays
cheap to load"*, and most of what this ADR decides is read when building, not every session.

- **`AGENTS.md` § Conventions** — the one-liners every session needs: no suffix taxonomy, colocated
  tests, Biome, `exports` as the boundary, one package per plugin.
- **`docs/build-process.md`** — the operational detail: the two cycle gates and the suppression
  convention, the script composition, and the permission allowlist.

## Consequences

- **The scaffold cell has an unambiguous brief.** Everything the roadmap said must not be improvised
  is now decided; nothing here needs a further decision before the scaffold is built.
- **The roadmap changes.** Its Phase 0 scaffold brief loses `cycle-check:update` and gains the
  two-gate shape (§4).
- **`exports` becomes load-bearing.** Every package must maintain it deliberately; a symbol that is
  not exported is genuinely unreachable, which is the intent and will occasionally be inconvenient.
- **Biome is an experiment with a fallback.** It is new to this project by choice. If it disappoints,
  the retreat is ESLint + Prettier, which costs the `noImportCycles` half of §4 and hands it back to
  a graph tool — the cross-package script is unaffected.
- **`.vue` linting is an open Phase 1 call**, not a decided one. It returns with files to judge.
- **A portable rule, beyond this repo.** §1's three tiers are the reusable output: adopt a suffix
  when a machine reads it, and treat an admired convention from another ecosystem as suspect until
  you can name the mechanism that consumed it there.
