# proposals

Thorough design write-ups for work that isn't decided or started yet — the place to grill a shape
before it's built. Living documents: a proposal is refined in place, then either graduates to an ADR
or is abandoned (kept, not deleted).

## Conventions

- **Filename:** `kebab-case-name.md`, **un-numbered** — *deliberately*, unlike ADRs. Proposals
  mutate; numbering would invite renumbering churn and broken links. ADRs are numbered *because* they
  record an immutable decision; proposals are named *because* they change. Cross-reference proposals
  by relative path, ADRs by id.
- **Status line first.** The first line after the title is `**Status:** <value> — optional clause.`,
  the grep-anchored form from `../README.md`. Vocabulary: `Draft` · `Research` · `Approved` ·
  `Partially implemented` · `Implemented`.
- **Mutability:** edit the status in place; **never rename or move** a file when its status changes.
  No `done/` or `in-progress/` subfolders — status changes constantly and refs are by path; this
  index does the organising instead.
- **Optional header lines** mirroring ADRs (`**Date:**`, `**Author:**`, `**Relates to:**`) are
  incidental, not required.
- Follow the house style from `../README.md`: **name the alternative you rejected**.

## The graduation rule (proposal → ADR)

When a proposal is **approved and building starts**, *and* the decision deserves a durable immutable
record, write the ADR (next number). The proposal's status line then points at it
(`**Status:** Implemented — see ADR-0007`). The proposal is **never deleted** — it stays as the
working history of *how* the decision was reached, which the terse ADR deliberately omits. Not every
proposal graduates; small ones can just reach `Implemented` without an ADR.

## Index

| Proposal | Status | Notes |
|---|---|---|
| `plugin-sdk-v2.md` | Draft | Fleshes ADR-0004 into a concrete surface. Checkpoint gate; freeze via `/grill-with-docs` before any plugin (Wave 0.2). |

## Note on ambiguous cases

None yet. When a doc doesn't fit cleanly (e.g. half-implemented, or a proposal that's really a
reference doc), record the judgement call here rather than smoothing it over silently.
