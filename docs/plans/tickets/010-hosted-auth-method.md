# 010 — How a hosted account authenticates ⛔

**Status:** ✅ Closed 2026-08-03 · **Type:** grilling · **Blocked by:** 001 ✅ · **Blocks:** 002 · **Claimed by:** Cal (wayfinder session 2026-08-03)

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

---

## Resolution — 2026-08-03

Grilled with Cal. Full reasoning and the rejected alternatives are in
[ADR-0008](../../adr/0008-hosted-authentication-social-oauth.md); the answers to the questions above:

1. **Social OAuth only — no passwords, no magic links, no transactional email.** The grilling opened
   on the dependency that separates the three mechanisms, and Cal ruled email out: almost everyone
   already has a Google/Apple/GitHub account, and delegating identity means ultrasonics never stores
   a login credential. That holds up — for login nothing is persisted but a provider name and an
   opaque subject id, so there is no password hash to leak and no reset flow to abuse.
2. **Launch ships Google alone.** Cal was explicit that one provider is not a comfortable resting
   place and wants several early — but a single provider at launch means the identity-collision
   problem cannot occur yet, so the linking UX is deferred rather than guessed at.
3. **Self-host does not use the same mechanism — it has no login wall at all.** OAuth-only cannot
   serve a LAN self-hoster: providers reject `http://192.168.1.50:8080` as a redirect target, so the
   flow has nowhere to terminate. Rather than build a self-host-only password path, self-host stays
   login-free by default and anyone wanting a wall is directed to a trusted reverse proxy — which
   ADR-0007 already supports as a session source. Supporting a user's proxy is out of scope.
4. **No password reset or recovery flow exists**, because no password does. Recovery is the identity
   provider's problem — a real transfer of risk, not its elimination: losing the Google account loses
   ultrasonics. Multi-provider linking is the eventual mitigation.
5. **No email verification at signup** — the provider has already done it.

**Schema handed to 002:** `accounts` carries no credential columns whatsoever. Identities live in
`federated_identities` — `(account_id, provider, subject_id)`, unique on `(provider, subject_id)`.
One identity per account in behaviour at launch, many by construction, because Cal expects more
providers early and the alternative is a migration on the account table ADR-0003 says must never
need one.

**One design change came out of the grilling rather than into it.** Cal proposed a `DISABLE_AUTH`
flag that accepts or skips the middleware — explicitly *not* the per-route guards ADR-0007 rejected.
But skipping the middleware leaves `req.session` undefined in self-host, so handlers either carry
null checks or reach `WHERE account_id = undefined` and silently return the wrong rows. The flag name
and the single switch survive; the branch moves *inside* the middleware, selecting the bootstrapped
source so `req.session` is always populated. One flag, one branch, one code path.

**On service auth, kept deliberately apart.** Cal raised Spotify-as-login and reported the natural
expectation that it would also connect Spotify for syncing. Recorded rule: a login identity and a
service connection are separate records with separate lifecycles; signing in with a service provider
*may offer* to seed a connection, but the account never depends on it — disconnecting Spotify from
syncing never affects login. Whether Spotify ships as a login provider at all is deferred; Cal was
content to scope to conventional identity providers if it adds complexity.

**Consequences for the map:**

- **ADR-0007 corrected in place** — its source table claimed the cookie source serves "any
  self-hoster who wants a real login", which OAuth-only makes untrue.
- **011 loses its premise** and narrows to first-run bootstrap plus proxy configuration.
- **New ticket 012** owns the collision rule for provider #2 — auto-linking on provider email is an
  account-takeover vector, and it must be settled before the second provider ships.
