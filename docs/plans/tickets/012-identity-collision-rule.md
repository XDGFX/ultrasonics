# 012 — The identity-collision rule for provider #2

**Status:** ✅ resolved 2026-10-15 (agreed by Cal in session; ADR-0016 accepted 2026-10-15) · **Type:** grilling · **Blocked by:** — · **Blocks:** — · **Claimed by:** Claude (wayfinder session 2026-10-15)

## Question

When a second OAuth provider reports an email that matches an existing account, what happens?

[ADR-0008](../../adr/0008-hosted-authentication-social-oauth.md) settled that hosted authenticates by
social OAuth only, that launch ships **Google alone**, and that identities live in a
`federated_identities` join table so an account *can* hold several. It deliberately did not settle
the linking rule, because with one provider the collision cannot occur — and Cal was explicit that
more providers are wanted early, so this stops being hypothetical on the day provider #2 ships.

The scenario: someone signs up with Google as `cal@gmail.com`. Later they return, don't remember
which button they pressed, and click GitHub — which reports the same `cal@gmail.com`. Three
behaviours are possible and none is obviously right:

- **Auto-link** on matching email — the friendliest, and an **account-takeover vector**. Provider
  email is neither stable nor always verified: Google primary addresses change, GitHub lets a user
  set their public email freely, and some providers will assert an unverified address. If a provider
  can be made to assert an email, auto-linking hands over the account that owns it.
- **Block** with "this email is already registered with Google" — safe, mildly annoying, and it
  leaks which providers an email is registered with.
- **Create a second account** — never right in practice: from the user's point of view their
  playlists have silently vanished.

## To decide

- The rule itself, and whether it varies by whether the provider asserts the email as verified.
- Whether **deliberate linking** (an authenticated user adds a second provider from settings) is a
  separate, safer path — it is, since identity is already established — and whether that is the
  *only* way an account ever gains a second identity.
- What unlinking does, including the rule that an account must never be left with zero identities.
- Whether provider email is stored at all. ADR-0008 has `accounts` holding no credentials and
  identities keyed by opaque `subject_id`; storing email for matching reintroduces a mutable key.

## A good resolution

- The linking rule named, with the takeover vector explicitly addressed rather than traded away.
- Whether settings-initiated linking is the sole path to a second identity.
- Any column this adds to `federated_identities`, handed to 002 if it is still open.
- An ADR — it is a user-auth checkpoint surface (`AGENTS.md`).

## Notes

Not urgent: launch is Google-only and the collision is impossible until a second provider exists.
But it **must** be settled *before* provider #2 ships, not during — the wrong default here is a
security bug that looks like a convenience feature.

## Answer

Agreed with Cal on 2026-10-15. The decision is
[ADR-0016](../../adr/0016-identity-linking-and-the-collision-rule.md), and the reasoning is there
too. In short:

1. **Settings is the only way to add an identity.** Sign-in either resolves an identity to the
   account that owns it or creates a new account. It never attaches an identity to an existing one.
2. **A collision at sign-in is blocked, with a hint.** An unknown identity whose verified email
   matches an existing identity is refused, and no account is created. The message names the
   original provider and points to linking from settings. There is no auto-linking even when the
   email is verified, because "verified by the provider" says nothing about who holds the address
   today.
3. **Unlinking is refused if it would leave zero identities**, enforced by the server. It never
   revokes sessions, because a session belongs to the account. You may remove the identity you
   signed in with, as long as another one remains.
4. **No merges, no moves.** Linking an identity owned by another account is refused.
5. **`federated_identities.email`**: nullable, verified addresses only (unverified ones would let an
   attacker squat an address), lowercased with no further normalisation, refreshed on every sign-in,
   non-unique index. It is read only by the collision check.
6. **Link and unlink both need a sign-in within the last 10 minutes.** This adds
   `sessions.authenticated_at`.

**Handed to 002 (already closed):** both columns are written into ADR-0009 §5's migration table as an
amendment.

**Left as fog:** an alert when an identity is linked is the standard takeover alarm, but it needs a
channel to reach the user. It joins the map's Notifications item.
