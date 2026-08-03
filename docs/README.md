# docs

The project's shared memory. In-repo so it's versioned with the code and every agent reads it by
default. Higher-level session logs and cross-project decisions may also live in Cal's Notion; the
in-repo docs are the source of truth for anything an agent needs to build correctly.

| Folder | What it holds | Written by | Mutable? |
|---|---|---|---|
| `adr/` | Architecture Decision Records — the immutable "why" | Cal, at decisions | Append-only; supersede, never edit |
| `specs/` | One per feature — the contract; acceptance criteria = the test contract | `/grill-with-docs` | Frozen once implementation starts |
| `proposals/` | Thorough design write-ups for work not yet decided/started | Agents / Cal | Living until accepted |
| `plans/` | Order of work + current status: `roadmap.md` (what), `operating-model.md` (how), `wave-board.md` (live state) | Agents | Living |
| `reference/` | Durable facts (e.g. the v1 architecture the port targets) | Agents | Updated as facts change |
| `handoffs/` | Where an agent left off, so the next resumes cold | Agent at context end | One per boundary |
| `sessions/` | Dated log of what happened and what's next | Agent at session end | Append-only |

`specs/` is created when the first `/grill-with-docs` session produces one; it doesn't exist yet.

## Conventions

- **British English**, concise, practical — these are internal working documents.
- **ADRs**: `NNNN-kebab-title.md`, header `# ADR-NNNN — Title`, then `Status:` / `Date:` and
  `Context` / `Decision` / `Consequences`. Number sequentially; a wrong decision is superseded by a
  new ADR that references it, never edited away.
- **Status lines are grep-anchored.** Any doc with a status starts it with the exact token
  `**Status:**` (bold *label*, plain value) as the first line after the title, so one regex spans
  everything: `grep -rn '^\*\*Status:\*\*' docs/`. The label is the fixed anchor; the value varies.
  Fixed vocabularies — **ADRs**: `Accepted` · `Complete` · `Superseded`. **Proposals**: `Draft` ·
  `Research` · `Approved` · `Partially implemented` · `Implemented`.
- **Every non-obvious rule or decision names the alternative it rejected** — one clause is enough
  (ADRs, proposals, edit-site comments). Cheap to write; saves the "why not X?" archaeology later.
- **Cross-reference by id** (`ADR-0004`, `CONTEXT.md`) so the graph stays navigable.
- The rule from `AGENTS.md`: **no PR merges without its spec**, and non-obvious calls get an ADR.

## Current decisions (ADRs)

- **0001** — Stack: TypeScript / Bun / Vue monorepo
- **0002** — Open-core with a hosted SaaS revenue tier
- **0003** — Full multi-tenancy, single-tenant self-host default
- **0004** — Typed plugin SDK with explicit registration
- **0005** — AuthProvider abstraction, bring-your-own by default
- **0006** — Preserve the song dict and fuzzymatch verbatim

Start with `../CONTEXT.md` (domain glossary) and `plans/roadmap.md` (where the work is going).
