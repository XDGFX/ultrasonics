# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the
strings actually used in this repo's issue tracker.

This repo's tracker is local markdown (`issue-tracker.md`), so a "label" is the **value of the
`**Status:**` line** at the top of an implementation issue file — not a GitHub label. Nothing
here touches `XDGFX/ultrasonics`.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), write the corresponding
string from the right-hand column into the issue's `**Status:**` line.

## Not the same vocabulary as wayfinder tickets

`docs/plans/tickets/` uses its own `**Status:**` vocabulary (`Open` / `claimed` / `resolved`) —
that is deliberate and unrelated. The label anchor is shared; the value set is per document type,
as `docs/README.md` sets out. Never apply a triage role to a wayfinder decision ticket, or vice
versa.

Edit the right-hand column to change vocabulary. If this repo ever moves to GitHub Issues, these
same five strings become GitHub labels and `triage` will create the four that don't yet exist
(`wontfix` already does).
