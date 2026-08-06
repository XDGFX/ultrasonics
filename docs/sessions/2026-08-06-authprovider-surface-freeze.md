# 2026-08-06 — AuthProvider surface freeze (map ticket 006)

**Session type:** wayfinder — work through the map. One ticket resolved.

## What changed

Resolved map ticket [006](../plans/tickets/006-authprovider-surface.md), the second of the two
Phase 0 contract freezes (005 froze the plugin SDK earlier the same day).

- **New:** [ADR-0013](../adr/0013-authprovider-surface-service-grants-and-declared-fields.md) —
  the AuthProvider surface: service grants and declared fields.
- **Frozen:** `docs/proposals/auth-provider-v2.md` moved off `Draft`; it is now the specification,
  with the reasoning living in the ADR.
- **Glossary:** `CONTEXT.md` gains **Service**, **Grant** and **Flow** under "Service auth" —
  `service` became a contract string, so it needed defining.
- **Map:** 006 into Decisions-so-far; **007 unblocked** and annotated with how both prerequisites
  narrowed it; two new fog entries (account-level BYO; whether the auth wizard shares 016's
  renderer).

## The decision in one line

A grant belongs to a `service` — shared by design between plugins declaring the same one — and its
shape is a declared Zod `fields` object, separate from `flow`.

## Two findings worth remembering

**v1's Last.fm never had a working BYO path.** `up_lastfm.py` collects only a username and imports
its API key from `ultrasonics.tools.api_key` — the dead `ultrasonics-api` proxy. It is a second
broken proxy path, less visible than Spotify's because it fails quietly. The flow/field split fixes
it as a side effect rather than as separate work.

**The draft proposal had no way to save a pasted token.** Its four methods described an OAuth
redirect dance; `requirements()` told the UI what to ask for and there was nowhere to put the
answer. The offline BYO paste — the *default* path in ADR-0005 — had no method. `configure()` is
the fix.

## Where a later session should push back

Two places the freeze chose deliberately against an available argument, so they are the first things
to re-examine if something feels wrong:

- **Lazy refresh inside `resolve()`** was chosen *against* ADR-0009's clear-text `expires_at`, which
  exists specifically to make scheduler-driven refresh cheap. The reasoning is that cheap is not a
  reason to make it the contract — but if the scheduler lands early anyway, that reasoning is worth
  re-reading rather than inheriting.
- **The reconnect surface throws** where ADR-0012's `test()` returns plain data. These look
  inconsistent on purpose: ADR-0010's subclass erasure only binds when information must cross the
  plugin boundary, and `resolve()` runs host-side so it never does. If `resolve()` ever moves inside
  the boundary, this flips.

## Next

Frontier is now 007, 008, 009, 011, 012, 013, 015, 016 — 007 first in order and freshly unblocked.
With 005 and 006 both frozen, the SDK and AuthProvider halves of the Phase 0 exit gate are done;
what remains on the map is mostly not on the gate's critical path.
