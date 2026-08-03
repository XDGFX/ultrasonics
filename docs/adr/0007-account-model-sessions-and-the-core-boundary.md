# ADR-0007 — The account model, sessions, and the core boundary

**Status:** Proposed
**Date:** 2026-08-03
**Refines:** ADR-0003 (does not supersede its decision — only fixes the vocabulary and fills in the model it left open)

## Context

ADR-0003 decided *that* every persisted row and API route carries an owner scope, that self-host and
hosted run the same code, and that self-host stays login-free by default. It deliberately did not
decide the entity model underneath, and map ticket 001 exists to close that gap before the schema
(002) and the `AuthProvider` surface (006) are designed on top of a guess.

ADR-0003 wrote that scope up as a **tenant**. In the grilling session that produced this ADR the
owner's first response to the term was that they did not know what it meant or where it came from —
it was jargon introduced by an agent writing up a decision, not a concept the owner had chosen. The
underlying decision (isolation from day one) was genuinely theirs; the word was not. A term nobody
outside the documents uses is a standing tax on every future reader, so it is retired here.

## Decision

### 1. One entity: `Account`

A person and the boundary that owns their data are the **same thing, one-to-one, permanently**. One
hosted subscription means exactly one login, forever; a household sharing a single sync setup is not
a use case ultrasonics serves. There is no separate person entity and no membership join.

**"Tenant" is retired as a term.** It leaves `CONTEXT.md`, the planning docs, and the proposals. The
isolation discipline ADR-0003 bought is unchanged — it is simply spelled `account_id` now:

- Every persisted row carries `account_id`.
- Every API route resolves an account before it touches data.

Should many-people-per-subscription ever become real, it is a deliberate migration undertaken with
paying customers and evidence — not a seam paid for today on a guess.

### 2. Sessions are server-side rows

A logged-in request is identified by an **opaque HTTP-only cookie referencing a `sessions` row**,
not a JWT.

A JWT's advantage is verification without a database lookup, which pays off across many stateless
machines. ultrasonics is one server that owns its own database, so that advantage is unrealised
while the cost — no instant revocation without reintroducing a denylist lookup — is real. A session
row revokes individually (log out one device) or by `account_id` (log out everywhere), and self-host's
frictionless mode is expressible as an ordinary session row that does not expire.

### 3. Authentication is never bypassed, only sourced differently

A single middleware **always** resolves a `Session`. What varies by configuration is where that
session comes from:

| Source | Typical use |
|---|---|
| Session cookie | Hosted; any self-hoster who wants a real login |
| Bootstrapped account | Self-host default — no prompt, no wall |
| Trusted-proxy header | Users already running Authelia or similar in front |

**All three sources are available in every deployment.** Self-host merely *defaults* to the
frictionless one; a self-hoster who wants login exactly like hosted changes configuration, not
builds. Reducing friction is the default, not a ceiling on what self-host can do.

Route handlers never branch on deployment mode — they read `req.session` and nothing else. The
rejected alternative was a `DISABLE_AUTH` flag making route guards no-ops, which creates a second
code path where a forgotten guard is invisible in self-host and a data breach in hosted: exactly the
failure class ADR-0003 set out to eliminate.

### 4. Core receives capabilities, never identity

ADR-0003 said core stays ignorant of the owner scope. Concretely: **no function in core takes an
`accountId`.** The server resolves the account, builds objects already bound to it — an
`AuthProvider` scoped to that account's credentials, a store scoped to its rows — and passes those
in.

```ts
// server layer — identity lives here and goes no further
const provider = authProviderFor(session.accountId)
const applet   = await loadApplet(session.accountId, appletId)

// core layer — no accountId in the signature
runApplet(applet, { provider, logger })
```

Cross-account leakage is then **structurally impossible rather than a rule to remember**: core has
no vocabulary for "some other account", so it cannot name one whether by bug or by malice. The
rejected alternative — passing `accountId` into core and letting it query — moves the leak risk into
the layer ADR-0003 wanted kept ignorant, where every query must remember its `WHERE account_id = ?`.

## Consequences

- **Read-across for earlier ADRs.** ADR-0003 and ADR-0005 are historical records and are left as
  written. Where they say *tenant*, read **Account**; where ADR-0005 says credentials are stored
  "per tenant", read *per account*. Accepted ADRs are not rewritten (`AGENTS.md`) — they are refined
  by later ones like this.
- **Ticket 002 gets a concrete starting point:** `accounts`, `sessions`, and an `account_id` column
  on every owned table. It was retitled from "Tenant-scoped database schema" to "Account-scoped
  database schema".
- **Ticket 006 knows where credentials hang** — off an account, resolved server-side into a scoped
  `AuthProvider` before core is entered.
- **`TenantContext` disappears from the proposals.** `plugin-sdk-v2.md` and `auth-provider-v2.md`
  carried it in draft signatures; those become account-scoped capabilities supplied by the server.
- **Two questions this deliberately does not answer**, now their own tickets: how a hosted account
  authenticates (password, magic link, or social OAuth — ticket 010), and the self-host first-run and
  auth-mode configuration story (ticket 011).
- The simplification is genuinely load-bearing: one entity, one word, and an isolation guarantee that
  holds by construction rather than by discipline.
