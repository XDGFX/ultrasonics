# 009 — Triage the v1 issue backlog

**Status:** ✅ resolved 2026-10-15 (labels and closes applied at Cal's instruction) · **Type:** task (AFK) · **Blocked by:** — · **Blocks:** 017 · **Claimed by:** Claude (wayfinder session 2026-10-15)

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

## Answer

All 37 open issues are triaged in
[`v1-issue-triage.md`](../../reference/v1-issue-triage.md): 13 die with v1, 16 to preserve, 4 are
Phase 3 features and 4 are uncertain (#12, #14, #32, #41, which are Cal's call). Duplicates: #54 of
#47, #39 of #65. At Cal's instruction, the labels are applied to all 37 issues and the 14
dies-with-v1 and duplicate issues are closed with comments. 23 remain open.

**The deliverable is the "Must still work in v2" list**, eleven behaviours written to be lifted into
specs' acceptance criteria. The headline ones: an empty result is not a failure (#36), one bad song
never aborts a run (#38, #29, #49, #56), a blank fuzzy ratio defaults rather than crashes (#47), and
a run reports what it actually did (#30, #32). Of the examples suggested above, #36, #47 and #56
held up. #3 is already answered by ADR-0011. #5 was a to-do Cal filed and no user ever hit it.

### Handed forward

- **017 (new, ⛔ SDK)** — outputs return `void`, so "matched 0 of 50" has nowhere to go.
- **011, 013, 015, 016** — notes added to each ticket.
- **Map fog** — the conformance item gains runtime song-dict validation (#59). A new item covers
  more than one grant for the same service, which ADR-0013's `(account_id, service)` key rules out.
- **Not on this map:** playlist artwork (#52) and Spotify playlist folders would need new song-dict
  fields, and #32 is evidence for a review-unmatched screen. Both are Phase 3 or later, and both are
  recorded in the triage doc.
