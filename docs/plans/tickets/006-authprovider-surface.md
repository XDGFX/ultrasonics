# 006 — AuthProvider surface freeze ⛔

**Status:** ✅ resolved 2026-08-06 (agreed by Cal in session) · **Type:** grilling ·
**Blocked by:** 001 ✅ (cleared) · **Blocks:** 007 ·
**Claimed by:** Cal (wayfinder session, 2026-08-06)

## Question

What is the `AuthProvider` interface, concretely?

ADR-0005 decided the *abstraction* — a plugin declares what auth it needs; BYO / PKCE / Proxy
implementations decide how — and that credential storage is a checkpoint surface. It did not
specify a single type.

**This ticket has a prerequisite the review surfaced:** the Phase 0 exit gate requires freezing
`AuthProvider`, but unlike the SDK there was **no draft surface to freeze**. The SDK had
`plugin-sdk-v2.md`; `AuthProvider` had only an ADR. `../../proposals/auth-provider-v2.md` now
exists as the thing to grill — written as a starting point, explicitly not decided.

To settle:

- The `AuthSpec` shape a plugin declares (`defineAuth({ service, flow, scopes })`) and the flow
  vocabulary — is `pkce | oauth2 | apiKey | serverUrl | none` complete for the v1 plugin set?
- The `Credentials` shape handed to `run()`, and who refreshes an expired token — provider,
  runner, or plugin. v1 auto-renewed once inside the plugin on exception; v2 should not.
- Where BYO client IDs/secrets are entered and stored — per account, per plugin, both? **002 has now
  answered the storage half** (see the note below); what remains here is the resolution interface.
- **How the provider is handed to core.** ADR-0007 settled that core receives *capabilities, never
  identity*: the server builds an `AuthProvider` already bound to one account and passes it in, so no
  method on this interface should take an `accountId`. Scoping happens at construction. (The draft in
  `auth-provider-v2.md` still threads a `TenantContext` through every call — that is now wrong and
  the grilling should replace it.)
- The setup-wizard contract: what a provider must expose so the UI can walk a self-hoster through
  registering their own app.
- What `Proxy` needs reserved now so Phase 5 is additive, without building any of it.

> **Storage settled 2026-08-03 by [ADR-0009](../../adr/0009-database-schema-drizzle-sqlite-and-migrations.md)**
> (map ticket 002). Credentials live in a `credentials` table, one encrypted row per
> `(account_id, service)`: `secret` is the credential document under AES-256-GCM, `expires_at` and
> `key_version` sit in the clear so the refresh scheduler can find due rows without decrypting them.
> The server builds the provider already bound to one account, so **no method here takes an
> `account_id`** — it is bound at construction, and the raw connection is unreachable outside the db
> module anyway.
>
> Two things this hands the grilling rather than decides:
> - **Who refreshes.** `expires_at` being queryable in the clear makes a *scheduler-driven* refresh
>   cheap to implement — that is an argument available to this ticket, not a decision it has to take.
> - **Operator-level vs account-level BYO.** ADR-0009 §5 split v1's single settings table into
>   account-scoped `plugin_settings` and operator-owned `instance_settings`. A BYO client id/secret
>   registered once by whoever runs the instance belongs in the latter; one supplied by an individual
>   account belongs in the former. If this ticket concludes both paths are needed, both tables already
>   exist — no migration.

## A good resolution

- The frozen interface in `auth-provider-v2.md`, status moved off `Draft`.
- The BYO and PKCE paths fully specified; `Proxy` a named seam only.
- Consistency with 002 on where credentials physically live.

## Resolution — 2026-08-06

**A grant belongs to a `service`, and its shape is declared as `fields`.**
→ [ADR-0013](../../adr/0013-authprovider-surface-service-grants-and-declared-fields.md), which
carries the full reasoning, the rejected alternatives and the consequences.
[`auth-provider-v2.md`](../../proposals/auth-provider-v2.md) is now the frozen specification.

### Two findings that reframed the ticket

**`serverUrl` was never a flow.** Reading v1: `up_plex.py` collects `server_url` + `plex_token`,
both pasted, no OAuth anywhere; `up_lastfm.py` collects only a *username* and imports its API key
from `ultrasonics.tools.api_key` — **the dead proxy**. So Last.fm is not a working BYO path in v1 at
all; it is a second broken proxy path, less visible than Spotify's. Plex's flow ("paste a secret")
is identical to Last.fm's; only the field count differs. The draft's enum conflated *how the secret
is obtained* with *which fields are needed*.

**The draft had no way to save a pasted token.** `requirements()` told the UI what to ask for and
there was nowhere to put the answer — so the offline BYO paste path, which ADR-0005 makes the
*default*, had no method at all.

### The six questions, answered

1. **Flow vs fields**: split. `flow: "oauth2-pkce" | "oauth2" | "token" | "none"`; `fields` is a Zod
   object. `apiKey` and `serverUrl` leave the vocabulary — both are `token` flows. Last.fm gains a
   real offline path as a side effect. Plex's `serverUrl`/`verifyTls` are auth fields under
   ADR-0012's boundary rule; its path mapping stays `persistentSettings`.
2. **Grant identity**: `service`, and sharing is **the feature** — two plugins declaring the same
   `service` share one grant, preserving v1's spotify/spotify-mixer behaviour that ADR-0009's
   `(account_id, service)` key had already committed to. Price: `service` is a contract string, so
   `runConformance` checks it against a service registry.
3. **What the plugin receives**: `Credentials` is `z.infer` of the declared `fields`;
   `ctx.auth.get()` takes **no arguments** (a re-passed spec would be a second copy that can
   disagree — ADR-0012's reasoning for deleting the `component` declaration). Closes the shape
   ADR-0012 left open.
4. **Methods**: five, split by flow — `requirements()`/`resolve()` universal, `configure()` for
   `token`, `begin()`/`complete()` for `oauth2*`. A single `connect()` state machine was rejected:
   it makes the offline paste path pay for OAuth's complexity, backwards from ADR-0005.
5. **Refresh**: the provider's, **lazily inside `resolve()`** — one code path, correct when the
   scheduler is down. Explicitly against the argument ADR-0009 handed us (clear-text `expires_at`
   makes scheduled refresh cheap); cheap is not a reason to make it the contract. Scheduled pre-warm
   is a permitted optimisation, not Phase 1. The plugin never refreshes.
6. **Reconnect surface**: built **host-side**. `resolve()` is not plugin code, so the host already
   holds the typed failure; `ctx.auth.get()` just rejects and the plugin does nothing. Deliberately
   *not* `test()`'s plain-data shape — ADR-0010's subclass erasure only binds when the information
   must cross the boundary, and here it never does.

Plus: **BYO client credentials are operator-level** (`instance_settings`) in Phase 1;
account-level is deferred to the map's fog, not ruled out. **`Proxy` reserves three things** — no
provider named in `defineAuth`, `requirements()` may return empty, provider-supplied redirect URI.

### What this hands forward

- **Ticket 007** — unblocked, and narrowed: `ctx.auth.get()` is now a fixed zero-argument typed
  getter, so builder-time option fetching must not widen it.
- **Ticket 016** — the auth setup wizard needs a form from `requirements()` + `fields`; whether it
  shares 016's Zod renderer is left open there rather than decided here.
- **`runConformance`** gains a service-registry check on `service`.
- **The Plex port** must not look for `server_url` or the TLS toggle in settings.
- **New surface the draft lacked**: a service registry, since `service` is now load-bearing.

### Deliberately not decided here

- Whether the wizard shares 016's renderer.
- Account-level BYO — map fog, revisited if the Spotify platform-access wall (014) bites.
- Scheduled refresh — deferred, and additive when it returns.
