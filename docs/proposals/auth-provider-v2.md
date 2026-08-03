# Proposal: AuthProvider v2

**Status:** Draft — a starting point to grill, not a decided interface.

Fleshes out ADR-0005 (`AuthProvider` abstraction, BYO by default) into a concrete surface. Written
because the Phase 0 exit gate requires freezing `AuthProvider`, and unlike the plugin SDK there was
nothing to freeze — ADR-0005 records a decision, not a type. Freeze via ticket
[006](../plans/tickets/006-authprovider-surface.md).

Sibling to `plugin-sdk-v2.md`: that one owns what a plugin *declares*; this owns how the
declaration becomes usable credentials. Checkpoint gate (AGENTS.md) — Cal accepts before it freezes.

## Goals

1. A plugin declares *what* auth it needs and never encodes *how* (ADR-0005). The same plugin code
   runs unchanged under BYO, PKCE, and Proxy.
2. Self-host works **fully offline** with no service ultrasonics operates — the failure that killed
   v1 (`ultrasonics-api`, dead Nov 2022) must be structurally impossible to repeat.
3. Credentials are stored per account (ADR-0003, ADR-0007) and never reach the core domain logic.
4. A provider instance is **bound to one account at construction** — ADR-0007 puts identity at the
   server layer, so no method below takes an account id.
5. The hosted tier is an *additive* `Proxy` implementation, not a rewrite (ADR-0002).

## Proposed surface

### What a plugin declares

```ts
const spotifyOAuth = defineAuth({
  service: "spotify",
  flow: "oauth2-pkce",                  // pkce | oauth2 | apiKey | serverUrl | none
  scopes: ["playlist-read-private", "playlist-modify-private"],
});
```

The flow vocabulary must cover the whole v1 plugin set — `oauth2-pkce` (Spotify), `oauth2` (Deezer),
`apiKey` (Last.fm), `serverUrl` (Plex: a token plus a base URL), `none` (local files, playlist
merger, custom file). Whether that list is complete is an open question below.

### The provider interface

```ts
// Built by the server, already bound to one account (ADR-0007) — the instance *is* the scope,
// so identity appears nowhere in the method signatures.
interface AuthProvider {
  /** Credentials for a run. Refreshes transparently; throws if unrecoverable. */
  resolve(spec: AuthSpec): Promise<Credentials>;

  /** What the UI must collect from the user before `resolve` can succeed. */
  requirements(spec: AuthSpec): AuthRequirement[];

  /** Drive an interactive flow (OAuth redirect, PKCE exchange). */
  begin(spec: AuthSpec): Promise<AuthChallenge>;
  complete(spec: AuthSpec, callback: unknown): Promise<void>;
}
```

`Credentials` is deliberately opaque to the runner and narrow to the plugin — an access token, or
a token plus base URL for `serverUrl` flows.

**Refresh belongs to the provider, not the plugin.** v1 caught `SpotifyException` inside the plugin
and renewed once; every plugin re-implemented it. In v2 `resolve()` returns credentials already
valid, and a plugin that gets a 401 fails the run rather than repairing it.

### Implementations

- **BYO** (default) — the self-hoster registers their own developer app and supplies the client ID
  (and secret only where a service leaves no alternative). No network dependency on ultrasonics.
- **PKCE** — no client secret stored at all; preferred wherever the service supports it.
- **Proxy** — credentials brokered by a hosted service. Phase 5. Reserved as a seam here, not built.

Which provider is active is deployment configuration. The plugin cannot tell the difference.

### Setup wizard contract

`requirements()` is what makes BYO painless rather than a support burden: it returns a typed
description of what to collect (a client ID, a server URL, a token), enough for the UI to render a
form and link the service's developer-app page. This is the piece v1 never had.

## Open questions (grill in ticket 006)

- Is the **flow vocabulary** complete for the v1 plugin set, and is `serverUrl` (Plex) really an
  *auth* flow or a plugin setting that has drifted into auth?
- **Where do BYO client credentials live** — per account, per plugin, or a per-account service-level
  record shared by spotify and spotify-mixer? v1's two Spotify plugins shared one OAuth grant, and
  the port must too (`legacy-architecture.md`, port gotchas).
- **Encryption at rest** — are stored tokens encrypted, with what key, and how is that key supplied
  in self-host without adding first-run friction? Overlaps ticket 002.
- **Builder-time resolution** — `resolve()` is written for a run; dynamic option lists need
  credentials while an applet is being *built*. See ticket 007.
- **Failure surface** — how does an expired/revoked grant reach the user? A run that fails with
  "reconnect Spotify" is a UX contract, not just an exception.

## Out of scope

- The `Proxy` implementation and hosted app registrations (ADR-0002, roadmap Phase 5).
- User accounts, sessions, and login — a different thing that shares the word "auth". See ticket
  [001](../plans/tickets/001-account-model.md).
- Per-plugin auth logic; plugins declare, they do not implement.
