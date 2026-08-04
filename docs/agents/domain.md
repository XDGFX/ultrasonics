# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase. **Layout: single-context** — one `CONTEXT.md` and one `docs/adr/` at the repo root.

ADR-0001 plans a Bun-workspace monorepo under `packages/`, but package boundaries are not
bounded contexts: stay single-context unless a genuine second domain language appears, at which
point add a root `CONTEXT-MAP.md` and per-context `CONTEXT.md` files.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary.
- **`docs/adr/`** — read the ADRs that touch the area you're about to work in.

If a file doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it
upfront. `/domain-modeling` (reached via `/grill-with-docs` and `/improve-codebase-architecture`)
creates these lazily, when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
└── docs/
    └── adr/
        ├── 0001-stack-typescript-bun-vue-monorepo.md
        └── 0002-open-core-hosted-saas-revenue-model.md
```

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a refactor proposal, a hypothesis, a
test name — use the term exactly as `CONTEXT.md` defines it. Don't drift to synonyms the glossary
explicitly avoids (`account_id`, never "tenant"; the song dict, not "track object").

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing
language the project doesn't use (reconsider) or there's a real gap (note it for
`/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an accepted ADR, surface it explicitly rather than silently
overriding — `AGENTS.md` forbids re-litigating an accepted ADR without a superseding one:

> _Contradicts ADR-0010 (Worker-shaped plugin boundary, in-process in Phase 1) — but worth
> reopening because…_

## ADRs and specs are different documents

An **ADR** records a decision and its reasoning: immutable, append-only, superseded by a new ADR
rather than edited. A **spec** (`docs/specs/<feature>/spec.md`) commissions work: what must be
true for a feature to be done. A decision that shapes many features is an ADR; the contract for
one feature is a spec. See `issue-tracker.md`.
