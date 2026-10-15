# 2026-10-15 — The identity-collision rule for provider #2 (map ticket 012)

/wayfinder, working the map. One ticket resolved.

## Done

**Ticket 012 resolved.** Cal agreed every recommendation across two grilling rounds. The decision is
[ADR-0016](../adr/0016-identity-linking-and-the-collision-rule.md), which is Proposed.

- No auto-linking, ever, even on a verified email. Settings is the only way to add an identity.
- A colliding sign-in is blocked, and the message names the original provider. Unlinking never
  leaves zero identities. No merges and no moves.
- `federated_identities.email`: verified addresses only, lowercased, refreshed on sign-in, a hint
  rather than a key.
- Link and unlink need a sign-in within the last 10 minutes, which adds `sessions.authenticated_at`.
  Both columns are written into ADR-0009 §5's table.
- Added **Linking** to `CONTEXT.md`. The "new sign-in method added" alert joins the Notifications
  fog.

## Next

Cal to accept ADR-0016 (⛔ user auth). Frontier, first by number: 013, 015, 016, then 017 ⛔.
