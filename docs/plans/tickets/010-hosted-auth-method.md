# 010 — How a hosted account authenticates ⛔

**Status:** Open · **Type:** grilling · **Blocked by:** 001 ✅ · **Blocks:** 002 · **Claimed by:** —

## Question

When a person signs in to hosted ultrasonics, what do they actually present — a password, a magic
link, or a social identity (Google/Apple/GitHub)?

[ADR-0007](../../adr/0007-account-model-sessions-and-the-core-boundary.md) settled that there is one
`Account`, and that a logged-in request carries a server-side session behind an HTTP-only cookie. It
deliberately did **not** settle how that session is first obtained, because the choice is a genuine
product decision with real consequences and it deserved its own conversation rather than a footnote.

Why it blocks the schema (002): what the `accounts` table stores falls straight out of the answer —
a `password_hash`, or nothing at all plus a `federated_identities` table, or a short-lived token
table for magic links. Guessing here means a migration later on the one table ADR-0003 says must not
need retrofitting.

## To decide

- **The mechanism**, and whether more than one is supported at launch. Each has a distinct cost:
  passwords mean reset flows, breach exposure and hashing choices; magic links mean an email
  provider becomes a hard launch dependency and a login takes a round trip through an inbox; social
  OAuth means no password to leak but a dependency on providers whose terms and availability are
  outside your control.
- **Whether self-host uses the same mechanism.** ADR-0007 says a self-hoster must be *able* to run
  real login — but a self-hoster who wants a login wall and has no SMTP server is badly served by
  magic links, and one who has no public DNS cannot complete a social OAuth callback. The mechanism
  that is *available* offline may need to differ from the hosted default.
- **Password reset / account recovery**, if passwords are in play — and what recovery even means for
  a self-hosted single-account install with no email configured.
- **Email verification at signup** for hosted, and whether an unverified account can sync.
- Interaction with **service auth**: signing in with Google is user auth and has nothing to do with
  the `AuthProvider` that fetches Spotify credentials (`CONTEXT.md`). Keep them apart in the write-up
  — this is exactly the collision ADR-0007 renamed things to avoid.

## A good resolution

- The launch mechanism named, with the rejected alternatives and their costs recorded.
- The columns this implies for `accounts`, handed to 002.
- Whether self-host's real-login option uses the same mechanism or a simpler one.
- An ADR — it is a checkpoint surface (user auth, `AGENTS.md`) and future agents will need the "why".
