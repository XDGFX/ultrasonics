# Instructions for AI agents

Repo-wide rules for the **ultrasonics 2.0** revival. File-specific constraints live as
comments at their edit sites. The rewrite is in Phase 0. Read `GLOSSARY.md` for the domain
glossary and `docs/plans/roadmap.md` for where the work is heading.

## Read before you write

- **`GLOSSARY.md`** — the domain glossary. Use these terms exactly; do not invent synonyms.
- **`docs/adr/`** — accepted decisions. Do not re-litigate an accepted ADR; if you think one
  is wrong, write a superseding ADR, don't silently diverge.
- **`docs/plans/roadmap.md`** — the phase you're in and its exit gate.
- **Open GitHub issues labelled `wayfinder:map`** — any planning still under way. If your work
  depends on one of its open tickets, resolve that first; don't guess an answer a ticket exists to
  settle.

Read only when they apply — deliberately kept out of this file so it stays cheap to load:

- **`docs/build-process.md`** — the cell pipeline, wave sizing, the skill→gate map, and the
  scaffold conventions in operational detail (cycle gates, script composition, the agent permission
  allowlist). Read before building or dispatching code work; skip for planning and docs sessions.
- The **spec issue** for the feature you're building (the parent of your ticket) — its contract.
- **`docs/reference/legacy-architecture.md`** — how v1 works. Read when porting from it.

## Agent skills

Per-repo configuration the engineering skills read. Consult these when a skill asks where
something lives; you don't need them for ordinary sessions.

### Issue tracker

GitHub Issues on `XDGFX/ultrasonics`: wayfinder maps, specs and their tickets. v1 user issues are
touched only through `/triage`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged, as GitHub labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## The documentation discipline (enforced from day one)

- **Nothing lands without its spec.** Feature work belongs to a ticket whose parent is a spec issue,
  and satisfies its acceptance criteria. If there's no spec, the work isn't ready: write it first
  (`/grill-with-docs`, then `/to-spec` and `/to-tickets`). This binds whether the work arrives as a
  PR or as a direct commit to `revival`.
- **Hard-to-reverse design decisions get an ADR** in `docs/adr/`, in the `/domain-modeling`
  format: a title and a few sentences on what was chosen over what, and why. `Status: Proposed`
  until Cal accepts. An ADR records a design; how work is done belongs in this file or
  `docs/agents/`.
- **Close the ticket when its work lands** (`docs/agents/issue-tracker.md`). The issue, its
  comments and git history are the record; there are no handoff files or session logs.

## Branching

`revival` is the trunk and is **not production** — nothing deploys from it. Sequential work
(engine, core, docs) commits **directly to `revival`**; only parallel fan-out, chiefly Phase 2's
one-agent-per-plugin waves, uses a worktree and a PR — there the PR earns its keep by isolating
siblings and giving CI a per-unit verdict. Never merge to `master` (that's roadmap Phase 4) and
never force-push. Rationale, and the cell/wave machinery, in `docs/build-process.md`.

## Checkpoint gates — when to stop and ask Cal

Work autonomously, but **escalate rather than guess** on anything that touches:

- the **auth layer** — both senses: `AuthProvider` / credential storage / OAuth flows (service
  auth), *and* accounts, sessions, login (user auth). See `GLOSSARY.md`, "Auth".
- the **plugin SDK contract** (the shape plugins depend on),
- the **database schema** or a migration,
- **multi-tenancy / security** boundaries,
- anything a spec left genuinely ambiguous.

Everything else — a routine plugin port with green CI and a clean review — proceeds without a
checkpoint. Phase boundaries are always a checkpoint.

## Conventions

- **British English** everywhere: code, comments, docs, UI text, log messages, tests
  (`colour`, `initialise`, `behaviour`, `synchronise`).
- **Runtime is Bun**, not Node. Tests use `bun:test`. Frontend is **Vue 3 + Vite**.
- **TypeScript, strict.** No `any` in shipped code without a comment justifying it.
- **Monorepo** via Bun workspaces under `packages/` — see ADR-0001 for the package layout, and
  ADR-0014 for the conventions below. **One package per plugin**: `packages/plugins/<name>/`.
- **Name files for the concept they hold** (`song-dict.ts`), never for their layer. There is **no**
  `*.interface.ts` / `*.utils.ts` / `*.config.ts` taxonomy — a suffix is adopted only when a machine
  reads it, which here means `*.test.ts` alone (ADR-0014).
- **A package's `exports` field is its public surface**, and the only boundary that is actually
  enforced. Biome's `noPrivateImports` is on as a helpful default, not a guarantee.
- **Tests are colocated** as `*.test.ts` beside the code; test *data* lives in `test/fixtures/`.
- **Biome** is the linter and formatter (not ESLint/Prettier); `.vue` is out of its scope for now.
- **Validation is Zod.** The song dict, plugin settings, and API boundaries are Zod schemas;
  the TypeScript type is inferred from the schema, never hand-declared alongside it.
- **The song dict is sacred.** Its shape (`GLOSSARY.md`) is the interchange format between every
  plugin. Changing it is an ADR-level decision, never an incidental one.

## Quality gate

- `bun run test` — the **full** suite for the package you touched, not just changed files.
- `bun run check` — lint, format and type-check, locally and mutating. CI runs `check:ci`, which is
  the read-only variants plus the import-cycle gates, and fails rather than repairing (ADR-0014).
- Green is not "done", but red is "don't ask for review".
