# ADR-0008 — Hosted authentication is social OAuth only

**Status:** Proposed
**Date:** 2026-08-03
**Refines:** ADR-0007 (fills in how a session is first obtained; corrects one claim in its source table)

## Context

ADR-0007 settled that there is one `Account` and that a logged-in request carries a server-side
session behind an opaque HTTP-only cookie. It deliberately left open **how that cookie is first
obtained**, because the choice is a product decision with real consequences rather than a footnote.
Map ticket 010 exists to close it, and it blocks the schema (002): what the `accounts` table stores
falls straight out of the answer, and ADR-0003 is explicit that the owner scope is designed in from
the first migration — there is no later retrofit.

Three mechanisms were on the table, and the grilling opened on the dependency that separates them:
**is transactional email acceptable as a hard launch dependency?**

- **Passwords** do not need email to log in, but password *reset* does. Without it, recovery is
  "contact the maintainer" — workable at ten users, untenable at a thousand.
- **Magic links** make email *the* login path. An inbox delay or a spam classification is a total
  login outage, and an email provider becomes a launch blocker.
- **Social OAuth** needs no email infrastructure at all. The provider owns identity, verification
  and recovery.

## Decision

### 1. Hosted authenticates by social OAuth, and nothing else

No passwords, no magic links, no transactional email. Cal's reasoning, recorded as given: almost
everyone already has a Google, Apple, GitHub or similar account, and delegating identity means
**ultrasonics never stores a login credential**.

That second point survives scrutiny and is the strongest argument for the choice. For login,
ultrasonics persists neither a password nor the provider's tokens — it exchanges the authorisation
code server-side, reads a stable subject id, and mints its own session row. The only identity data at
rest is a provider name and an opaque subject id. There is no password hash to leak, no reset flow to
abuse, no email queue to depend on.

**Launch ships Google alone.** More providers are wanted early — Cal was explicit that a single
provider is not a comfortable resting place — but one provider at launch means the identity-collision
problem (below) cannot occur yet, so the linking UX is deferred rather than guessed at.

### 2. `accounts` holds no credentials; identities live in a join table

```
accounts               — no password_hash, no provider columns
federated_identities   — (account_id, provider, subject_id), unique on (provider, subject_id)
```

**One identity per account in behaviour at launch; many supported by construction.** The table is
built now even though nothing will use its cardinality for months, because the alternative —
`provider` and `subject_id` as columns on `accounts` — turns adding provider #2 into a data migration
on the account table at exactly the moment there are real users to lose. Empty capacity is cheap;
populated retrofits are not, and ADR-0003 names this table as the one that must not need retrofitting.

The rejected alternative was columns-on-`accounts` with the join table added when a second provider
ships. Given Cal expects several providers "fairly early", the migration was not a hypothetical cost.

### 3. Self-host has no login wall, and that is the whole story

OAuth-only cannot serve a self-hoster who wants a login wall, and the reason is structural rather
than inconvenient: OAuth requires the provider to redirect a browser to a callback URL it can reach.
Providers reject `http://192.168.1.50:8080`. **A self-hoster on a LAN with no public DNS cannot
complete a social login at all** — the flow has nowhere to terminate. Requiring every self-hoster to
register their own Google Cloud project, configure a consent screen and paste a client id is also not
"changing configuration" in any honest sense.

So self-host does not get a login wall:

- **Default: no authentication.** Same as v1, no regression (ADR-0003).
- **Anyone wanting a wall is directed to a trusted reverse proxy** (Authelia and similar), which
  ADR-0007 already supports as a first-class session source. Supporting a user's proxy configuration
  is explicitly outside ultrasonics' scope.

### 4. `DISABLE_AUTH` selects a source; it does not skip the middleware

Cal proposed a single middleware-level flag that accepts or skips the auth middleware — deliberately
*not* per-route guards, which ADR-0007 had rejected. The distinction matters anyway, and this is the
one place the grilling changed the design rather than recording it:

**If the middleware is skipped, `req.session` is undefined in self-host.** Every downstream handler
then either carries a null check, or it does not — and a query reaching `WHERE account_id =
undefined` returns the wrong rows silently instead of erroring. That is the second code path ADR-0003
set out to eliminate, relocated from the route guards into the session object.

The config name and the single switch survive; only the branch moves. `DISABLE_AUTH` selects the
**bootstrapped source inside the always-run middleware**, which returns the owner's session instead of
demanding a cookie. Self-host still never touches OAuth — no client id, no consent screen, no wall —
and `req.session` is guaranteed populated on every request, everywhere, so no handler ever copes with
its absence. One flag, one branch, one code path.

### 5. A login identity is never a service connection

Cal raised signing in with Spotify, and reported the natural expectation: logging in with Spotify
would also connect Spotify for syncing. This walks directly into the collision ADR-0007 renamed
things to avoid, because Spotify occupies both roles at once — it is a service ultrasonics already
OAuths to for playlist access (ADR-0005) and a candidate identity provider.

The rule, which holds whether or not Spotify ever ships as a login provider:

- A **login identity** (`federated_identities`) and a **service connection** (`AuthProvider`
  credentials) are separate records with separate lifecycles. They are never the same row.
- Signing in with a provider that is also a service **may offer to seed** a service connection.
- The account **never depends** on that connection. Disconnecting Spotify from syncing does not
  affect the ability to log in, and revoking service scopes does not revoke the session.

Cal's position: the seeding is desirable but not a hard requirement, and scoping to conventional
identity providers only is an acceptable outcome. So **whether Spotify ships as a login provider is
deferred**; the separation rule is decided now, so no future ticket can quietly collapse the two.

Worth recording for whoever picks that up: Spotify is OAuth2 without OIDC — there is no `id_token`,
so "login" means calling `/v1/me` with an access token. That is OAuth-as-login rather than
standards-based identity and needs deliberate server-side care.

## Consequences

- **Ticket 002 gets its columns.** `accounts` carries no credential fields at all; identity lives in
  `federated_identities`. There is no `password_hash` in the schema, in any deployment mode.
- **No email provider is a launch dependency.** No sending domain, no SPF/DKIM, no deliverability
  risk on the login path. If ultrasonics later wants to email users about sync failures, that is a
  new dependency on a non-critical path, not a revival of this decision.
- **One correction to ADR-0007.** Its source table describes the cookie source as serving "Hosted;
  any self-hoster who wants a real login". Under OAuth-only the second clause is no longer true, and
  the table is corrected in place. The three sources remain; what changes is that self-host's
  realistic choice is bootstrapped or trusted-proxy.
- **Ticket 011 loses its premise.** It was written on ADR-0007's "frictionless is a default, not a
  ceiling" framing. Self-host now has no login wall on offer, so 011 narrows to first-run bootstrap
  and how the proxy mode is configured.
- **A new ticket, 012**, owns the identity-collision rule for provider #2: what happens when a second
  provider reports an email matching an existing account. Auto-linking on email is an account-takeover
  vector — provider email is neither stable nor always verified — so this must be decided before the
  second provider ships, not during.
- **Account recovery is the provider's problem**, which is a genuine transfer of risk rather than its
  elimination: a user who loses their Google account loses ultrasonics. Multi-provider linking (the
  join table already permits it) is the eventual mitigation.
