# Issue tracker: Local Markdown

Issues and specs (you may know a spec as a PRD) for this repo live as markdown files **in this
repo**, on the `revival` branch. They are deliberately *not* GitHub issues:
`XDGFX/ultrasonics` is public with 275 stars and 40+ real user bug reports, and internal
planning would both leak into and drown that backlog. Keeping everything in-repo also means the
revival's whole paper trail lives or dies with the branch.

## Where things live

Three planning locations, each with one job:

```
docs/
├── adr/                     decided, and why       (immutable)
├── plans/
│   ├── map.md               still undecided        (index only)
│   └── tickets/             └ one per open decision
└── specs/
    └── <feature-slug>/
        ├── spec.md          the contract
        └── issues/
            ├── 01-<slug>.md the build slices
            └── 02-<slug>.md
```

| Artifact | Path | Written by |
|---|---|---|
| Spec (PRD) — the contract, with acceptance criteria | `docs/specs/<feature-slug>/spec.md` | `/grill-with-docs` |
| Implementation issue | `docs/specs/<feature-slug>/issues/NN-<slug>.md` | `/to-tickets`, `/triage`, `/qa` |
| Wayfinder map | `docs/plans/map.md` | `/wayfinder` |
| Wayfinder decision ticket | `docs/plans/tickets/NNN-<slug>.md` | `/wayfinder` |

**A spec and an ADR are not the same thing.** An ADR records a *decision* and why it was taken —
immutable, superseded rather than edited. A spec *commissions work*: what must be true for a
feature to be done, with acceptance criteria that double as the test contract, frozen once
implementation starts.

**A wayfinder ticket is not an implementation issue.** `docs/plans/tickets/` holds open
*questions* whose resolution is a decision; `map.md` is scoped to "what is still undecided, and
nothing else". When a decision ticket resolves, it produces an ADR or a spec — never a sibling
file in `tickets/`.

## Conventions

- One feature per directory under `docs/specs/`. Issues numbered from `01`, one file per ticket —
  never a single combined tickets file.
- **Triage state is a grep-anchored status line**, per `docs/README.md`: the first line after the
  title is exactly `**Status:**` (bold label, plain value), so
  `grep -rn '^\*\*Status:\*\*' docs/` spans every living doc. The permitted values for an
  implementation issue are the five triage roles in `triage-labels.md`.
- Comments and conversation history append to the bottom of the file under a `## Comments`
  heading.
- British English, per `AGENTS.md`.

## When a skill says "publish to the issue tracker"

Create a new file under `docs/specs/<feature-slug>/issues/` (creating the directory if needed),
with `**Status:** needs-triage` unless the skill specifies otherwise. If the feature has no
`spec.md` yet, that is the signal the work isn't ready — write the spec first (`AGENTS.md`,
"Nothing lands without its spec").

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. Cal will normally pass the path or the number directly. A
bare number is ambiguous between `docs/plans/tickets/` and a feature's `issues/` — ask which if
the context doesn't settle it.

## PRs as a request surface

**Off.** External GitHub PRs are not part of the triage queue.

## GitHub issues are read-only to these skills

The 40+ open issues on `XDGFX/ultrasonics` are evidence, not a work queue. Read them (`gh issue
list`, `gh issue view`) when a spec needs to know what real users actually hit. Anything
user-visible — commenting, labelling, closing — is Cal's to apply, not an agent's. See
`docs/plans/tickets/009-issue-triage.md`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket. This is the
layout already in use — read it, don't recreate it elsewhere.

- **Map**: `docs/plans/map.md` — the Notes / Decisions-so-far / Not-yet-specified body.
- **Child ticket**: `docs/plans/tickets/NNN-<slug>.md`, numbered from `001`, with the question in
  the body. The header line carries `**Status:**` (`Open` / `claimed` / `resolved`), `Type:`
  (`research`/`prototype`/`grilling`/`task`), `Blocked by:`, `Blocks:` and `Claimed by:`.
- **Blocking**: the `Blocked by: NNN, NNN` field. A ticket is unblocked when every ticket it
  lists is `resolved`.
- **Frontier**: scan `docs/plans/tickets/` for tickets that are open, unblocked and unclaimed;
  first by number wins.
- **Claim**: set `**Status:** claimed` and the `Claimed by:` field, and save, before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `**Status:** resolved`, then
  append a one-line gist + link to the Decisions-so-far section of `map.md`. A resolved ticket
  that decided something non-obvious also gets an ADR (`AGENTS.md`).
