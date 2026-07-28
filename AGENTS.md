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
- The relevant **`docs/specs/`** entry for the feature you're building — it is the contract.

## The documentation discipline (enforced from day one)

- **No PR merges without its spec.** A feature PR references the `docs/specs/` entry whose
  acceptance criteria it satisfies. If there's no spec, the work isn't ready — write it first
  (this is what a `/grill-with-docs` session produces).
- **Non-obvious decisions get an ADR.** If you chose X over a reasonable Y, record why in
  `docs/adr/` (next number, `Status: Proposed` until Cal accepts). Cheap to write, saves the
  archaeology later.
- **Write a handoff when you stop.** On finishing or running low on context, append a
  `docs/handoffs/` entry: Goal · Done · In-flight (branch/worktree) · Next concrete step ·
  Blockers · Files touched. The next agent must be able to resume cold.
- **Log the session.** Dated entry in `docs/sessions/`: what changed, what's next.

## Checkpoint gates — when to stop and ask Cal

Work autonomously, but **escalate rather than guess** on any PR that touches:

- the **auth layer** (`AuthProvider`, credential storage, OAuth flows),
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
