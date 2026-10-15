# 2026-10-15 — Triage the v1 issue backlog (map ticket 009)

/ wayfinder, working the map. One ticket resolved (AFK task).

## Done

**Ticket 009 — resolved.** All 37 open issues on `XDGFX/ultrasonics` are triaged in
`docs/reference/v1-issue-triage.md`: 13 die with v1, 16 to preserve, 4 are Phase 3 features and 4
are uncertain. It also lists eleven must-still-work behaviours to lift into specs.

- **Applied to GitHub at Cal's instruction:** all 37 issues labelled, and 14 closed with comments
  (13 dies-with-v1, plus #54 as a duplicate of #47). 23 remain open.
- New ticket **017 ⛔**: does an output return a run report? Outputs return `void`, so "matched 0
  of 50" has nowhere to go.
- Notes added to 011 (reverse proxies and subpaths), 013 (unknown plugins, a self-hosted
  `api_url`), 015 (retry, applets with no trigger) and 016 (a blank number must not coerce to 0).
- Map fog: the conformance item gains runtime song-dict validation. A new item covers more than
  one grant for the same service.

## Unverified

- Root cause of #56 (mainstream tracks not found by Spotify search).
- Whether #32's `KeyError: 'name'` is fixed on the 1.2.0 branch. Only `master` was checked.

## Next

Frontier, first by number: 011, 012 ⛔, 013, 015, 016, 017 ⛔.
