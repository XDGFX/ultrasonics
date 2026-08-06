# AuthProvider v2 — the frozen surface

**Status:** Frozen 2026-08-06 by map ticket
[006](../plans/tickets/006-authprovider-surface.md) →
[ADR-0013](../adr/0013-authprovider-surface-service-grants-and-declared-fields.md).
Changes only deliberately from here (checkpoint gate, ADR-0005).

Realises ADR-0005 (`AuthProvider` abstraction, BYO by default) as a concrete surface. Sibling to
`plugin-sdk-v2.md`: that one owns what a plugin *declares*; this owns how the declaration becomes
usable credentials. **ADR-0013 carries the reasoning and the rejected alternatives — this file is
the specification.**

## Goals

1. A plugin declares *what* auth it needs and never encodes *how* (ADR-0005). The same plugin code
   runs unchanged under BYO, PKCE, and Proxy.
2. Self-host works **fully offline** with no service ultrasonics operates — the failure that killed
   v1 (`ultrasonics-api`, dead Nov 2022) must be structurally impossible to repeat.
3. Credentials are stored per account (ADR-0009) and never reach the core domain logic.
4. A provider instance is **bound to one account at construction** (ADR-0007), so no method below
   takes an account id.
5. The hosted tier is an *additive* `Proxy` implementation, not a rewrite (ADR-0002).

## What a plugin declares

```ts
const spotifyOAuth = defineAuth({
  service: "spotify",
  flow: "oauth2-pkce",
  scopes: ["playlist-read-private", "playlist-modify-private"],
});

const plexAuth = defineAuth({
  service: "plex",
  flow: "token",
  fields: z.object({
    serverUrl: z.string().url(),
    token: z.string().min(1),
    verifyTls: z.boolean().default(true),
  }),
});
```

**`flow` and `fields` are separate axes** (ADR-0013 §1). `flow` is how the secret is obtained;
`fields` is what must be collected.

| `flow` | Meaning | `fields` | v1 examples |
|---|---|---|---|
| `oauth2-pkce` | Interactive redirect, no client secret stored | supplied by the SDK: `{ accessToken }` | Spotify |
| `oauth2` | Interactive redirect, client secret required | supplied by the SDK: `{ accessToken }` | Deezer |
| `token` | User pastes a secret | declared by the plugin | Plex, Last.fm |
| `none` | No credentials at all | — | local files, playlist merger, custom file |

There is no `apiKey` or `serverUrl` flow: both are `token` flows differing only in their fields.

**`service` is the grant identity.** Two plugins declaring the same `service` share one grant, by
design — `spotify-mixer` declares `service: "spotify"` and inherits Spotify's connection, preserving
v1 behaviour. `service` is a contract string, not a label: `runConformance` asserts it matches a
known service-registry entry.

Under ADR-0012's boundary rule — *if you cannot open an authenticated connection without it, it is
auth, not a setting* — Plex's `serverUrl` and `verifyTls` are auth fields, **not**
`persistentSettings`. Its path mapping remains `persistentSettings`.

## What a plugin receives

```ts
async inputs(ctx) {
  const { serverUrl, token, verifyTls } = await ctx.auth.get();
}
```

`ctx.auth.get()` takes no arguments — the plugin already declared its spec. `Credentials` is
`z.infer` of the declared `fields`, so it is fully typed and plain data by construction (ADR-0010).

**A plugin never refreshes and never retries auth.** `resolve()` returns credentials already valid;
a plugin that sees a 401 fails the run. If the grant is unrecoverable, `ctx.auth.get()` rejects, the
plugin catches nothing, and the runner attaches the reconnect action host-side (ADR-0013 §6).

## The provider interface

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

`resolve()` runs **host-side**, behind the `ctx.auth` facade — it is not plugin code and does not
execute inside the plugin boundary.

**Refresh is the provider's, lazily inside `resolve()`.** A scheduled pre-warm calling the same
method is a permitted optimisation and is not Phase 1, even though ADR-0009 kept `expires_at` in the
clear to make one cheap.

## Storage

Per ADR-0009, unchanged by this freeze:

- One encrypted row per `(account_id, service)` in `credentials` — `secret` under AES-256-GCM,
  `expires_at` and `key_version` in the clear.
- **BYO client credentials are operator-level in Phase 1**: one registered developer app per service
  per instance, in operator-owned `instance_settings`. Account-level BYO
  (`plugin_settings`) is deferred, not ruled out — no migration needed if it returns.

## Implementations

- **BYO** (default) — the self-hoster registers their own developer app and supplies the client ID
  (and secret only where a service leaves no alternative). No network dependency on ultrasonics.
- **PKCE** — no client secret stored at all; preferred wherever the service supports it.
- **Proxy** — credentials brokered by a hosted service. Phase 5, **seam only**.

Which provider is active is deployment configuration. The plugin cannot tell the difference.

### What `Proxy` reserves

1. Nothing in `defineAuth` may name a provider — selection is deployment configuration.
2. `requirements()` may return an **empty list**; the UI must handle "nothing to fill in, just press
   Connect" rather than treating empty as an error.
3. The redirect URI in `begin()` is provider-supplied, not derived from the local instance URL.

## Setup wizard contract

`requirements()` plus the declared `fields` schema is what makes BYO painless rather than a support
burden: enough for the UI to render a form and link the service's developer-app page. This is the
piece v1 never had.

Whether that form renders through ticket [016](../plans/tickets/016-settings-form-generation.md)'s
Zod form generator or its own renderer is **not decided here**.

## Out of scope

- The `Proxy` implementation and hosted app registrations (ADR-0002, roadmap Phase 5).
- User accounts, sessions, and login — a different thing that shares the word "auth"
  (`CONTEXT.md`, "Auth"); settled by ADR-0007 and ADR-0008.
- Per-plugin auth logic; plugins declare, they do not implement.
- Builder-time credential resolution for dynamic option lists — ticket
  [007](../plans/tickets/007-dynamic-options.md).
