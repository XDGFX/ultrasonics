# docs

The project's shared memory. In-repo so it's versioned with the code and every agent reads it by
default. Higher-level session logs and cross-project decisions may also live in Cal's Notion; the
in-repo docs are the source of truth for anything an agent needs to build correctly.

| Folder | What it holds | Written by | Mutable? |
|---|---|---|---|
| `adr/` | Architecture Decision Records — the immutable "why" | Cal, at decisions | Append-only; supersede, never edit |
| `specs/` | One folder per feature: `spec.md` (the contract; acceptance criteria = the test contract) plus `issues/` (its build slices) | `/grill-with-docs`, `/to-tickets` | `spec.md` frozen once implementation starts; `issues/` living |
| `agents/` | Per-repo config the engineering skills read: issue tracker, triage labels, domain docs | `/setup-matt-pocock-skills` | Living; edit directly |
| `proposals/` | Thorough design write-ups for work not yet decided/started | Agents / Cal | Living; edited in place through to `Implemented`, never deleted |
| `plans/` | `roadmap.md` (what to build, when) and `map.md` + `tickets/` (what's still undecided) | Agents | Living |
| `reference/` | Durable facts (e.g. the v1 architecture the port targets) | Agents | Updated as facts change |
| `handoffs/` | Where an agent left off, so the next resumes cold | Agent at context end | One per boundary |
| `sessions/` | Dated log of what happened and what's next | Agent at session end | Append-only |

`specs/` is created when the first `/grill-with-docs` session produces one; it doesn't exist yet.

**Two planning docs, and how not to confuse them.** `roadmap.md` = what to build and in what
order, with each phase's exit gate. `map.md` = the open **decisions**, one per ticket in
`plans/tickets/`, with their blocking edges, the fog, and what's ruled out of scope. A decided thing
leaves the map and becomes an ADR or a spec; it never lives in two places.

*How* work is dispatched and gated is `build-process.md`, kept out of `AGENTS.md` so that
file stays cheap to load every session. There was previously an `operating-model.md` and a
`wave-board.md` too; both were folded away — the board tracked nothing that was running, and the
operating model was largely a hand-rolled version of what `/wayfinder` and `AGENTS.md` now cover.

## Conventions

- **British English**, concise, practical — these are internal working documents.
- **ADRs**: `NNNN-kebab-title.md`, header `# ADR-NNNN — Title`, then `**Status:**` / `**Date:**` and
  `Context` / `Decision` / `Consequences`. Number sequentially; a wrong decision is superseded by a
  new ADR that references it, never edited away.
- **Status lines are grep-anchored.** Any doc with a status starts it with the exact token
  `**Status:**` (bold *label*, plain value) as the first line after the title, so one regex spans
  everything: `grep -rn '^\*\*Status:\*\*' docs/`. The label is the fixed anchor; the value varies.
  Fixed vocabularies — **ADRs**: `Proposed` (new, awaiting Cal) · `Accepted` · `Superseded`.
  **Proposals**: `Draft` · `Research` · `Approved` · `Partially implemented` · `Implemented`.
  **Issues** (`specs/*/issues/`): the five triage roles — `needs-triage` · `needs-info` ·
  `ready-for-agent` · `ready-for-human` · `wontfix` (see `agents/triage-labels.md`).
  **Plans**: free-form, but the line must be present so the survey sees living docs too.
- **Every non-obvious rule or decision names the alternative it rejected** — one clause is enough
  (ADRs, proposals, edit-site comments). Cheap to write; saves the "why not X?" archaeology later.
- **Cross-reference by id** (`ADR-0004`, `CONTEXT.md`) so the graph stays navigable.
- The rule from `AGENTS.md`: **no PR merges without its spec**, and non-obvious calls get an ADR.

## Current decisions (ADRs)

- **0001** — Stack: TypeScript / Bun / Vue monorepo
- **0002** — Open-core with a hosted SaaS revenue tier
- **0003** — Full multi-account isolation, single-account self-host default
- **0004** — Typed plugin SDK with explicit registration
- **0005** — AuthProvider abstraction, bring-your-own by default
- **0006** — Preserve the song dict and fuzzymatch verbatim
- **0007** — The account model, sessions, and the core boundary *(refines 0003; retires "tenant")*
- **0008** — Hosted authentication is social OAuth only *(refines 0007; Google alone at launch)*
- **0009** — The v2 database: relational SQLite, Drizzle, account scoping in the query layer
- **0010** — Worker-shaped plugin boundary, in-process execution in Phase 1 *(refines 0001, 0004)*

Start with `../CONTEXT.md` (domain glossary) and `plans/roadmap.md` (where the work is going).
