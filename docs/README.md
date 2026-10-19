# docs

The project's shared memory. In-repo so it's versioned with the code and every agent reads it by
default. Higher-level session logs and cross-project decisions may also live in Cal's Notion; the
in-repo docs are the source of truth for anything an agent needs to build correctly.

| Folder | What it holds | Written by | Mutable? |
|---|---|---|---|
| `adr/` | Architecture Decision Records — the immutable "why" | Cal, at decisions | Append-only; supersede, never edit |
| `agents/` | Per-repo config the engineering skills read: issue tracker, triage labels, domain docs | `/setup-matt-pocock-skills` | Living; edit directly |
| `proposals/` | Thorough design write-ups for work not yet decided/started | Agents / Cal | Living; edited in place through to `Implemented`, never deleted |
| `plans/` | `roadmap.md`: the phases, in order, with each one's exit gate | Agents | Living |
| `reference/` | Durable facts (e.g. the v1 architecture the port targets) | Agents | Updated as facts change |

**Where planning lives.** `roadmap.md` = what to build and in what order. Everything else is a
GitHub issue (`agents/issue-tracker.md`): a wayfinder map and its decision tickets while the way is
unclear, then a spec and its tickets. A decided thing lives in exactly one place.

*How* work is dispatched and gated is `build-process.md`, kept out of `AGENTS.md` so that
file stays cheap to load every session. There was previously an `operating-model.md` and a
`wave-board.md` too; both were folded away — the board tracked nothing that was running, and the
operating model was largely a hand-rolled version of what `/wayfinder` and `AGENTS.md` now cover.

## Conventions

- **British English**, concise, practical — these are internal working documents.
- **ADRs**: `NNNN-kebab-title.md`, header `# ADR-NNNN — Title`, in the `/domain-modeling` format: a
  few sentences on what was decided over what, and why, with `Considered options` and
  `Consequences` only when they earn their place. Number sequentially; a wrong decision is
  superseded by a new ADR that references it, never edited away. Older ADRs are longer.
- **Status lines are grep-anchored.** Any doc with a status starts it with the exact token
  `**Status:**` (bold *label*, plain value) as the first line after the title, so one regex spans
  everything: `grep -rn '^\*\*Status:\*\*' docs/`. The label is the fixed anchor; the value varies.
  Fixed vocabularies — **ADRs**: `Proposed` (new, awaiting Cal) · `Accepted` · `Superseded`.
  **Proposals**: `Draft` · `Research` · `Approved` · `Partially implemented` · `Implemented`.  **Plans**: free-form, but the line must be present so the survey sees living docs too.
- **Every non-obvious rule or decision names the alternative it rejected** — one clause is enough
  (ADRs, proposals, edit-site comments). Cheap to write; saves the "why not X?" archaeology later.
- **Cross-reference by id** (`ADR-0004`, `GLOSSARY.md`) so the graph stays navigable.
- The rule from `AGENTS.md`: **nothing lands without its spec**, and hard-to-reverse design calls
  get an ADR.

## Current decisions (ADRs)

- **0001** — Stack: TypeScript / Bun / Vue monorepo
- **0002** — Open-core with a hosted SaaS revenue tier
- **0003** — Full multi-account isolation, single-account self-host default
- **0004** — Typed plugin SDK with explicit registration
- **0005** — AuthProvider abstraction, bring-your-own by default
- **0006** — Preserve the song dict and fuzzymatch verbatim *(superseded by 0022)*
- **0007** — The account model, sessions, and the core boundary *(refines 0003; retires "tenant")*
- **0008** — Hosted authentication is social OAuth only *(refines 0007; Google alone at launch)*
- **0009** — The v2 database: relational SQLite, Drizzle, account scoping in the query layer
- **0010** — Worker-shaped plugin boundary, in-process execution in Phase 1 *(refines 0001, 0004)*
- **0011** — Triggers are server capabilities, not plugins *(refines 0001, 0004)*
- **0012** — The plugin SDK surface is keyed by component
- **0013** — The AuthProvider surface: service grants and declared fields
- **0014** — Monorepo conventions: naming, boundaries and gates
- **0015** — Self-host first run and the auth-source switch
- **0016** — Identity linking and the collision rule
- **0017** — The v1 importer
- **0018** — The scheduler and the inbound webhook
- **0019** — Settings forms are rendered from JSON Schema
- **0020** — Outputs return a result per playlist
- **0021** — The runner validates the song dict at each plugin boundary
- **0022** — Design the song dict and the matcher fresh *(supersedes 0006)*
- **0023** — The v2 song dict's shape
Start with `../GLOSSARY.md` (domain glossary) and `plans/roadmap.md` (where the work is going).
