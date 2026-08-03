# 009 — Triage the v1 issue backlog

**Status:** Open · **Type:** task (AFK) · **Blocked by:** — · **Blocks:** — · **Claimed by:** —

## Question

Which of the 40+ open issues on `XDGFX/ultrasonics` still mean anything after a full rewrite?

Not a decision so much as work that unblocks decisions: the backlog is currently the only record of
what real users actually hit, and it is unlabelled and unread. Roadmap Phase 3's exit gate says
"backlog issues triaged and linked" — but nothing before Phase 3 does the triage, so Phases 1 and 2
would be built without the evidence.

**A rewrite invalidates most of it**, and that is the point of triaging early rather than late.
Expect four buckets:

- **Dies with v1** — install/dependency pain (#39, #48, #65 Levenshtein C++, #66 Flask/Werkzeug),
  and anything about the dead `ultrasonics-api` proxy (#61). Close with a note pointing at 2.0.
- **Real behaviour to preserve or fix** — the ones describing a *domain* problem the rewrite must
  still answer: #3 (triggers sequential — already ticket 004), #36 (Plex zero-song playlist), #47
  (empty fuzzy ratio crash), #5 (global settings radio/select), #56 (unsearchable songs).
  These are Phase 1–2 acceptance-criteria material.
- **Feature requests for Phase 3** — #43 YouTube, #44 Tidal, #55 Apple Music, #52 playlist poster.
- **Uncertain** — leave open, note why.

## A good resolution

- Every open issue in a bucket, with labels applied so the buckets are queryable.
- A short list of the "must still work in v2" behaviours, linked from wherever the relevant spec
  will live — this is the actual deliverable; the label-tidying is secondary.
- No mass-closing without a comment: these are real users, several still watching (roadmap Phase 4
  wants to re-engage them).

## Note

Touches the public repo. Agent drafts the triage and the comment wording; **Cal applies anything
user-visible** — closing an issue is outward-facing.
