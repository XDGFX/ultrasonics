# ADR-0016 — Identity linking and the collision rule

**Status:** Accepted
**Date:** 2026-10-15
**Refines:** ADR-0008 §1, which deferred the linking rule until a second provider exists
**Amends:** ADR-0009 §5's initial migration: `federated_identities` gains `email`, `sessions` gains
`authenticated_at`.
**Ticket:** [`docs/plans/tickets/012-identity-collision-rule.md`](../plans/tickets/012-identity-collision-rule.md)

## Context

ADR-0008 ships Google alone and stores identities in `federated_identities`, so an account can hold
several. It left one rule open on purpose: what happens when provider #2 reports an email that
matches an existing account. With one provider, that cannot happen. Once a second provider ships, it
can happen on the first day.

The pressure points are these. Matching on email automatically is friendly, but it is an
account-takeover vector, because a provider's email is neither stable nor always verified. If sign-in
silently creates a second account instead, the user sees their playlists vanish. And since
settings-initiated linking is the only way to add an identity, a stolen session plus a link becomes
a way to keep access.

## Decision

### 1. Settings is the only way to add an identity

An identity is attached to an existing account only when a signed-in user adds it from settings.
Sign-in does exactly two things: it resolves an identity to the account that already owns it, or it
creates a new account. It never attaches an identity to an account, whatever the email says.

### 2. A collision at sign-in is blocked, with a hint

Sometimes a sign-in arrives with an unknown `(provider, subject_id)` whose verified email matches an
existing identity. In that case, sign-in is refused and no account is created. The message names
the provider the email is registered with, and tells the user to sign in with that provider and then
add the new one in settings.

**There is no auto-linking, even when the provider asserts the email is verified.** A verified email
only means the provider checked it at some point. Recycled addresses, Workspace admins who can mint
any address on their domain, and lax providers all survive that check.

Naming the provider leaks which provider an email uses. It leaks only to someone who has just proved
to another provider that they control an identity carrying that email, which is a weak position for
enumeration. A message that names no provider would leave the user guessing between buttons, and
that guessing is the problem this rule exists to solve.

### 3. Unlinking never leaves zero identities

The server refuses an unlink that would leave the account with no identities. The UI hiding the
button is not enough. Unlinking does not revoke sessions, because a session belongs to the account,
not to the identity it started from (ADR-0007). Removing the identity you signed in with is allowed,
as long as another one remains.

### 4. No merges, no moves

Linking an identity that already belongs to another account is refused. ADR-0007 makes an account
1:1 with its data, permanently. A merge would have to reconcile applets, grants and run history, and
moving the identity could leave the other account with no identities. Someone who really holds two
accounts deletes one first.

### 5. Provider email is a verified, lowercased hint, never a key

`federated_identities` gains a nullable `email` column:

- It is set **only** when the provider asserts the address is verified. Matching on unverified
  addresses would let an attacker squat a victim's address before the victim ever signs up.
- It is stored lowercased and normalised no further. Stripping Gmail dots or `+tags` is
  provider-specific guesswork.
- It is refreshed on every sign-in through that identity.
- It has a non-unique index, because stale values can legitimately coincide.
- It is read by the collision check in §2 and by nothing else. It is never a login key.

When the email is unverified or missing, the collision check is skipped, and a sign-in from an
unknown identity creates a new account.

### 6. Link and unlink need a recent sign-in

Both operations need the session to have authenticated within the last 10 minutes. Otherwise the
user signs in again through an existing identity first. Unlink is covered as well as link, because
linking your own provider and then unlinking the owner's provider is the full takeover. `sessions`
gains `authenticated_at`, which a fresh sign-in advances and ordinary use does not.

## Consequences

- **The takeover vector is closed rather than traded away.** Nothing outside settings, gated by a
  recent sign-in, can attach an identity to an account.
- **Two columns join the initial migration:** `federated_identities.email` and
  `sessions.authenticated_at`. Neither is used until provider #2 ships. They are added now under the
  same reasoning ADR-0008 used for the join table: empty columns cost little, and adding them later
  means a migration on tables that by then hold real users.
- **Self-host is untouched.** ADR-0015 creates no identity rows in any self-host mode, so none of
  this applies there.
- **No linking alert.** The usual alarm for this ("a new sign-in method was added to your account")
  needs a channel to reach the user. ADR-0008 kept email off the critical path, so the alert is
  deferred to the open question of notifications rather than decided here.
- **A user who lost access to their only provider is still locked out.** Linking from settings
  mitigates that only for users who set up a second provider before they needed it.
