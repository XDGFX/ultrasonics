# ADR-0013 — The AuthProvider surface: service grants and declared fields

**Status:** Proposed
**Date:** 2026-08-06
**Refines:** ADR-0005 (which decided the `AuthProvider` *abstraction* and BYO-by-default, but
recorded a decision rather than a type — this is the type)
**Constrained by:** [ADR-0007](0007-account-model-sessions-and-the-core-boundary.md) (core receives
capabilities, never identity — so no method here takes an `account_id`),
[ADR-0009](0009-database-schema-drizzle-sqlite-and-migrations.md) (one encrypted credential row per
`(account_id, service)`; the `instance_settings` / `plugin_settings` split),
[ADR-0010](0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md) (the plugin boundary
is Worker-shaped; credentials are plain data),
[ADR-0012](0012-plugin-sdk-surface-keyed-by-component.md) (which deferred `ctx.auth`'s shape here,
and fixed the boundary rule: *if you cannot open an authenticated connection without it, it is
auth, not a setting*)
**Ticket:** [`docs/plans/tickets/006-authprovider-surface.md`](../plans/tickets/006-authprovider-surface.md)

## Context

ADR-0005 introduced `AuthProvider` because v1 routed public-service auth through
**ultrasonics-api**, a hosted proxy holding the secrets, which died on Heroku's free tier in
Nov 2022 and broke Spotify sync for every new install. It decided the abstraction — a plugin
declares *what* auth it needs, implementations decide *how* — and named BYO the default. It did not
specify a single type, so unlike the plugin SDK there was no draft surface to freeze;
`docs/proposals/auth-provider-v2.md` was written for this ticket as a starting point to grill.

Three prior decisions narrowed the job. ADR-0007 put identity at the server layer, which deletes
the `TenantContext` the draft threaded through every call. ADR-0009 settled storage: one encrypted
row per `(account_id, service)`, `expires_at` in the clear, and two settings tables — operator-owned
`instance_settings` and account-scoped `plugin_settings`. ADR-0012 left `ctx.auth` deliberately
unshaped and handed over a boundary rule that moves Plex's `server_url` and TLS toggle out of
settings and into this ticket's scope.

**A survey of the v1 plugin set reframed the flow vocabulary.** The draft proposed
`pkce | oauth2 | apiKey | serverUrl | none`. Reading the plugins:

- **Plex** (`up_plex.py`) collects a `server_url` and a `plex_token`, both pasted by the user, and
  appends `X-Plex-Token` to every request. There is no OAuth anywhere in it.
- **Last.fm** (`up_lastfm.py`) collects only a *username*. Its API key is not its own — it is
  imported from `ultrasonics.tools.api_key`, i.e. it came from the dead proxy. Last.fm is not a
  working BYO path in v1; it is a second broken proxy path, just less visible than Spotify's.
- **Spotify** and **Deezer** are genuine interactive OAuth redirect flows.

So `serverUrl` was never a flow. Plex's flow — "paste a secret" — is identical to Last.fm's; what
differs is that Plex needs two fields where Last.fm needs one. The draft's enum conflated *how the
secret is obtained* with *which fields are needed*, which means every new field shape would have
invented a new flow.

A second finding, from the draft itself rather than v1: its four methods
(`resolve`/`requirements`/`begin`/`complete`) describe an OAuth redirect dance and provide **no way
to save a pasted token**. `requirements()` tells the UI what to ask for and there is nowhere to put
the answer. The default path in ADR-0005 — the offline BYO paste — had no method.

## Decision

**A grant belongs to a service, and its shape is declared as fields.**

### 1. `flow` and `fields` are separate axes

```ts
const spotifyOAuth = defineAuth({
  service: "spotify",
  flow: "oauth2-pkce",                    // how the secret is obtained
  scopes: ["playlist-read-private", "playlist-modify-private"],
});                                       // fields supplied by the SDK for oauth2* flows

const plexAuth = defineAuth({
  service: "plex",
  flow: "token",                          // paste a secret
  fields: z.object({                      // what must be collected
    serverUrl: z.string().url(),
    token: z.string().min(1),
    verifyTls: z.boolean().default(true),
  }),
});
```

`flow` is `"oauth2-pkce" | "oauth2" | "token" | "none"`. `apiKey` and `serverUrl` are gone from the
vocabulary: both are `token` flows differing only in their declared `fields`. Last.fm becomes
`flow: "token"` with a single `apiKey` field — which also converts it from a broken proxy path into
a real BYO one.

For `oauth2*` flows the SDK supplies the `fields` schema itself (`{ accessToken }`); only `token`
flows declare their own. `verifyTls` sits here rather than in `persistentSettings` under ADR-0012's
boundary rule: you cannot open an authenticated connection to a self-signed Plex server without it.

### 2. `service` is the grant identity, and sharing is the feature

Two plugins declaring the same `service` **share one grant, by design**. This is not an accident to
be guarded against — it is the v1 behaviour the port is required to preserve
(`legacy-architecture.md`: spotify and spotify-mixer share one Spotify auth), and ADR-0009's
`(account_id, service)` unique key had already committed to it at the storage layer without the SDK
saying so.

`spotify-mixer` therefore declares `service: "spotify"` and inherits the connection. The cost is
that `service` becomes a **contract string rather than a label**, so `runConformance` asserts it
matches a known service-registry entry — a typo would otherwise silently open a second, empty
grant.

### 3. `Credentials` is inferred from the declared fields

```ts
async inputs(ctx) {
  const { serverUrl, token } = await ctx.auth.get();   // typed { serverUrl, token, verifyTls }
}
```

`ctx.auth.get()` takes **no arguments**. The plugin already declared its `AuthSpec`; passing one
back in would be a second copy that can disagree with the first — the same reasoning that deleted
the `component` declaration in ADR-0012. `Credentials` is `z.infer` of the declared `fields`, so
plugin code needs no casting and no union-narrowing, and it is plain data by construction, which
satisfies ADR-0010's `structuredClone` constraint without a separate rule.

### 4. Five methods, split by which flows use them

```ts
// Built by the server, already bound to one account (ADR-0007) — the instance *is* the scope,
// so identity appears nowhere in these signatures.
interface AuthProvider {
  /** Universal. What the UI must collect before `resolve` can succeed. May be empty. */
  requirements(spec: AuthSpec): AuthRequirement[];

  /** Universal. Credentials for a run; refreshes transparently; rejects if unrecoverable. */
  resolve(spec: AuthSpec): Promise<Credentials>;

  /** `token` flows. Validate against the declared `fields` and write the encrypted row. */
  configure(spec: AuthSpec, input: unknown): Promise<void>;

  /** `oauth2*` flows only. */
  begin(spec: AuthSpec): Promise<AuthChallenge>;
  complete(spec: AuthSpec, callback: unknown): Promise<void>;
}
```

`configure()` is the method the draft was missing, and it carries the *default* path in ADR-0005.

**Rejected:** collapsing `begin`/`complete`/`configure` into a single `connect()` state machine.
It reads tidier, but it makes the offline paste path pay for OAuth's complexity — backwards from
ADR-0005, where BYO is the default and OAuth is the elaboration.

### 5. Refresh is the provider's, lazily, inside `resolve()`

The plugin never refreshes. v1 caught `SpotifyException` inside each plugin and renewed once, and
every plugin re-implemented it; in v2 a plugin that sees a 401 fails the run rather than repairing
it.

Refresh happens **lazily inside `resolve()`** — one code path, correct when the scheduler is down
or the instance has been switched off for a week. A scheduled pre-warm calling the same method is
permitted as an optimisation and is explicitly **not Phase 1**.

Note this runs *against* an argument ADR-0009 handed us: it kept `expires_at` in the clear
specifically so a refresh scheduler could find due rows without decrypting them, which makes
scheduler-driven refresh cheap to build. Cheap is not a reason to make it the contract. The clear
column stays useful; it just becomes an optimisation's enabler rather than the mechanism.

### 6. The reconnect surface is built host-side

`resolve()` runs **host-side, behind the `ctx.auth` facade** — it is not plugin code and does not
execute inside the plugin boundary. So when a grant is expired or revoked, the host already holds
the typed failure and does not need to recover it from whatever crosses the boundary.

`ctx.auth.get()` therefore simply rejects; the plugin catches nothing and does nothing; the runner
marks the run failed and attaches the reconnect action to the applet, built from the provider's own
typed failure.

This is deliberately *not* the shape ADR-0012 gave `test()`. That returns plain data because
ADR-0010 constraint 4 erases a thrown `Error`'s subclass across the boundary — but that erasure
only binds when the information has to cross. Here it never does, so plugins are not made to check
a result union for a failure they cannot act on.

### 7. BYO client credentials are operator-level, in Phase 1

One registered developer app per service per instance, in ADR-0009's operator-owned
`instance_settings`. Self-host is realistically one person, and the hosted tier reaches for `Proxy`
rather than asking each account for a client ID.

Account-level BYO (`plugin_settings`, which already exists — no migration) is **not out of scope,
it is deferred**: it is the natural fallback if the Spotify platform-access wall found by ticket
014 bites the hosted tier. It sits in the map's fog.

### 8. What `Proxy` reserves

Phase 5, named seam only, no implementation. Three reservations make "additive" mean something:

1. **Which provider is active is deployment configuration** — never a per-plugin or per-applet
   choice. Nothing in `defineAuth` may name a provider.
2. **`requirements()` may return an empty list.** Proxy asks the user for nothing, so the UI must
   already handle "nothing to fill in, just press Connect" rather than treating empty as an error.
3. **The redirect URI in `begin()` is provider-supplied**, not derived from the local instance URL,
   so a hosted callback drops in unchanged.

## Consequences

- **`ctx.auth`'s shape is now fixed**, closing the gap ADR-0012 left open. Ticket 007 inherits a
  zero-argument typed getter and must fetch builder-time options without widening it.
- **Last.fm gains a working offline path** it did not have in v1, as a side effect of the flow/field
  split rather than as separate work.
- **`service` is load-bearing**, so it needs a service registry and a conformance check. This is new
  surface area the draft did not have.
- **Plex's `verifyTls` and `server_url` leave `persistentSettings`** and become auth fields, per
  ADR-0012's boundary rule. The Plex port must not look for them in settings.
- **The setup wizard has a typed contract** — `requirements()` plus the `fields` schema — which is
  the piece v1 never had. Whether it renders through ticket 016's Zod form generator or its own
  renderer is not decided here.
- **Scheduled refresh is deferred, not forbidden.** The lazy path must exist first; adding a
  pre-warm later changes no signature.
- ADR-0005's checkpoint-gate status carries over: this surface changes only deliberately.
