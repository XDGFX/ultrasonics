# Instructions for AI agents

Repo-wide rules for the **ultrasonics 2.0** revival. File-specific constraints live as
comments at their edit sites. This is currently a **documentation-only** repo: the code
rewrite has not started. Read `CONTEXT.md` for the domain glossary and `docs/plans/roadmap.md`
for where the work is heading.

## Read before you write

- **`CONTEXT.md`** — the domain glossary. Use these terms exactly; do not invent synonyms.
- **`docs/adr/`** — accepted decisions. Do not re-litigate an accepted ADR; if you think one
  is wrong, write a superseding ADR, don't silently diverge.
- **`docs/plans/roadmap.md`** — the phase you're in and its exit gate.
- **`docs/plans/map.md`** — the decisions still open. If your work depends on one, resolve its
  ticket first; don't guess an answer a ticket exists to settle.

Read only when they apply — deliberately kept out of this file so it stays cheap to load:

- **`docs/build-process.md`** — the cell pipeline, wave sizing and the skill→gate map. Read before
  building or dispatching code work; skip for planning, decision and docs sessions.
- The relevant **`docs/specs/`** entry — the contract for the feature you're building.
- **`docs/reference/legacy-architecture.md`** — how v1 works. Read when porting from it.

## Agent skills

Per-repo configuration the engineering skills read. Consult these when a skill asks where
something lives; you don't need them for ordinary sessions.

### Issue tracker

Local markdown, in-repo — specs and their implementation issues under `docs/specs/<feature>/`,
open decisions under `docs/plans/`. GitHub Issues is read-only evidence, never a work queue.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged, written as the `**Status:**` value on an implementation
issue. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## The documentation discipline (enforced from day one)

- **Nothing lands without its spec.** Feature work references the `docs/specs/` entry whose
  acceptance criteria it satisfies. If there's no spec, the work isn't ready — write it first
  (this is what a `/grill-with-docs` session produces). This binds whether the work arrives as a
  PR or as a direct commit to `revival`.
- **Non-obvious decisions get an ADR.** If you chose X over a reasonable Y, record why in
  `docs/adr/` (next number, `Status: Proposed` until Cal accepts). Cheap to write, saves the
  archaeology later.
- **Write a handoff when you stop.** On finishing or running low on context, append a
  `docs/handoffs/` entry: Goal · Done · In-flight (branch/worktree) · Next concrete step ·
  Blockers · Files touched. The next agent must be able to resume cold.
- **Log the session.** Dated entry in `docs/sessions/`: what changed, what's next.

## Branching

`revival` is the trunk and is **not production** — nothing deploys from it. Sequential work
(engine, core, docs) commits **directly to `revival`**; only parallel fan-out, chiefly Phase 2's
one-agent-per-plugin waves, uses a worktree and a PR — there the PR earns its keep by isolating
siblings and giving CI a per-unit verdict. Never merge to `master` (that's roadmap Phase 4) and
never force-push. Rationale, and the cell/wave machinery, in `docs/build-process.md`.

## Checkpoint gates — when to stop and ask Cal

Work autonomously, but **escalate rather than guess** on anything that touches:

- the **auth layer** — both senses: `AuthProvider` / credential storage / OAuth flows (service
  auth), *and* accounts, sessions, login (user auth). See `CONTEXT.md`, "Auth".
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
- **Monorepo** via Bun workspaces under `packages/` — see ADR-0001 for the package layout.
- **Validation is Zod.** The song dict, plugin settings, and API boundaries are Zod schemas;
  the TypeScript type is inferred from the schema, never hand-declared alongside it.
- **The song dict is sacred.** Its shape (`CONTEXT.md`) is the interchange format between every
  plugin. Changing it is an ADR-level decision, never an incidental one.

## Quality gate (once code exists)

The gate below is the target the moment the first package lands; until then it's aspirational.

- `bun run test` — the **full** suite for the package you touched, not just changed files.
- `bun run check` — lint, format, and type-check (read-only in CI; may mutate locally).
- Green is not "done", but red is "don't ask for review".
