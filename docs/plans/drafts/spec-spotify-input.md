# Draft spec: the Spotify input plugin and the PKCE provider

> **Draft for grilling, not filed.** Spec 5 of 8 on the [Phase 1 specs](https://github.com/XDGFX/ultrasonics/issues/100) map. Builds on [the plugin SDK](https://github.com/XDGFX/ultrasonics/issues/108), [the runner](https://github.com/XDGFX/ultrasonics/issues/110) and the [Server spec](spec-server.md), whose `LocalAuthProvider` this spec extends with the `oauth2-pkce` flow. Settles open question 2 of [the Vue UI spec](https://github.com/XDGFX/ultrasonics/issues/118).
>
> Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md).
>
> Spotify facts below come from Spotify's developer documentation as read on 16 November 2026. The sources are listed at the end, because several changed during 2025 and 2026.

## Problem Statement

Spotify is the near end of the exit gate: "a real Spotify playlist syncs to Plex through the UI". v2 has no Spotify plugin, and no `AuthProvider` can complete an OAuth flow.

v1's Spotify input broke every new install when the `ultrasonics-api` proxy holding its secret died in November 2022 (ADR-0005; v1 #61). It also broke on odd playlist items: local files have a null `id`, removed and unavailable items come back as a null track, and v1's error handler itself crashed on one (must-still-work #5; v1 #29, #30). A track with a blank name reached Plex with no `title` (#38).

Spotify has since narrowed what a self-hoster's app may do:

- **Redirect URIs (from 9 April 2025).** A redirect URI must use HTTPS unless it is a loopback IP literal (`http://127.0.0.1:PORT` or `http://[::1]:PORT`). `localhost` is refused. A LAN address such as `http://192.168.1.50:5000` cannot be registered at all.
- **Development mode (February and March 2026).**
  - An app allows **five** users, each allowlisted by hand.
  - The owner needs **Premium**.
  - A playlist's items can be read **only if the user owns or collaborates on it**. Any other playlist answers 403.
  - `GET /playlists/{id}/tracks` became `/items`, and each entry's `track` became `item`.
- **Extended quota (from 15 May 2025).** Only organisations with at least 250,000 monthly active users may apply. Every self-hoster will therefore run their own development-mode app.
- **New apps (from 27 November 2024).** New apps cannot read Spotify-owned algorithmic or editorial playlists, Discover Weekly among them.

## Solution

Two pieces, in one ticket:

1. **The `oauth2-pkce` flow in the server's `LocalAuthProvider`** (ADR-0005, ADR-0013 §4–5), for any `oauth2-pkce` service, with Spotify's endpoints in a server-side table. The operator registers a Spotify app and pastes its client ID into the wizard. No client secret exists anywhere (ADR-0005: "no client secret is stored at all"). `begin()` builds an authorise URL with a PKCE challenge. `complete()` exchanges the code. `resolve()` refreshes lazily and rejects with an `AuthFailure` when the grant can't be recovered.
2. **A new plugin, `spotify`,** in its own package, with an `inputs` component in `playlists` mode. It reads the playlists the applet names, or all of the user's own and collaborative playlists, and maps each track to a `Song`. It skips what can't be a song, with a warning, and never aborts a read. It is registered as `spotify` in `officialPlugins`.

The setup wizard is #118's shell around the shared renderer (ADR-0025 §6). This spec decides what the provider tells it: the requirements, the client form and the redirect URI. It adds no bespoke page.

## User Stories

**Connecting**

1. As a self-hoster, I want to register my own Spotify app and paste only its client ID, so that Spotify works without a hosted proxy or a client secret (ADR-0005).
2. As a self-hoster, I want the wizard to show me the exact redirect URI to register before I create the app, with a copy button (#118 story 49).
3. As a self-hoster who reaches ultrasonics at a LAN address, I want a way to finish connecting even though Spotify won't accept that address as a redirect URI.
4. As a self-hoster, I want the wizard to tell me development mode's limits (five allowlisted users, Premium on the owner's account) before I start, so that a 403 doesn't surprise me.
5. As a user, I want Connect to send me to Spotify, ask for read access to my playlists only, and bring me back connected.
6. As a user who cancels on Spotify's consent page, I want the wizard to say so rather than hang.
7. As a user, I want my connection to keep working for months without reconnecting, so that scheduled syncs run unattended (ADR-0013 §5).
8. As a user whose grant was revoked on Spotify, or whose operator changed the client ID, I want the next run to fail with a reconnect action and the services list to show Spotify in magenta (ADR-0013 §6; v1 #56).
9. As a user, I want "test" to tell me whether my token was refused, Spotify was unreachable, or my Spotify account isn't on the app's user list.
10. As a future `spotify` output in Phase 2, I want to share this grant through `service: "spotify"` (ADR-0013 §2).

**Choosing what to read (instance settings, `inputs`)**

11. As a user, I want to name the playlists to read by pasting their links, so that two playlists with the same name are never confused.
12. As a user, I want to read all my own and collaborative playlists, optionally leaving some out by name.
13. As a user, I want the form to explain that playlists I only follow can't be read, so that I know why they're missing.
14. As a user, I want my Liked Songs read as one playlist with a name I choose (open question 4).

**Reading**

15. As a user, I want each playlist emitted with its Spotify name, its description and its Spotify id.
16. As a user, I want each song to carry its title, artists, album, release date, ISRC, duration, explicit flag and Spotify id, so that the matcher has the strongest keys available (ADR-0023).
17. As a user, I want songs in the order Spotify holds them.
18. As a user, I want a local file in a playlist carried with its title and artists and no Spotify id, with a warning, so that it can still match on the other side (must-still-work #5).
19. As a user, I want a removed or unavailable item, an episode, or an item with no title skipped with a warning while the rest of the playlist reads, so that one odd item never aborts a run (must-still-work #2, #5; v1 #29, #38).
20. As a user, I want a song with no artists carried with an empty artist list, which the song dict allows (ADR-0023).
21. As a user, I want a chosen playlist I can't read (deleted, private to someone else, or only followed) skipped with a warning naming it, while the others read (ADR-0020: "an input's skips go through `ctx.log`").
22. As a user with a 2,000-song playlist, I want every song read, page by page.
23. As a user, I want a Spotify rate limit to slow the run down, not fail it (open question 7).
24. As a user, I want a refused token mid-run to fail the run, not to be retried by the plugin (ADR-0013 §5).
25. As a user, I want the input's log to say which playlists it read, how many songs each had, and what it skipped.
26. As a user, I want my access and refresh tokens kept out of every log line and stored error.

**Maintainers**

27. As a maintainer, I want the plugin to pass `runConformance`.
28. As a maintainer, I want every test to run offline, against fake Spotify servers, so that CI needs no Spotify account.
29. As a maintainer, I want the PKCE flow tested end to end against a fake Spotify accounts service, refresh and rotation included.
30. As the v1 importer (Phase 2), I want stable setting names, so that v1's Spotify applet settings have somewhere to go (ADR-0017 §5). Its grant cannot carry across (ADR-0017, Context).

## Implementation Decisions

### The `oauth2-pkce` flow in `LocalAuthProvider` ⚑ checkpoint: auth layer

The class and its home are the Server spec's (its open question 6). This spec adds the flow.

- **Service endpoints are server-side data,** not SDK declarations: a table from `Service` to `{ authoriseUrl, tokenUrl }`, with Spotify's `https://accounts.spotify.com/authorize` and `/api/token`. `defineAuth` stays as ADR-0013 §1 has it ("it never encodes *how* the credentials are obtained"). The table's URLs are injectable so tests point them at a fake.
- **The operator's client** is `{ clientId }`, read and written through the operator-settings file in the Server spec (its open question 5), under the key `oauth-client:<service>`.
- **`requirements(spec)`:** `[{ kind: "client", service }, { kind: "connect" }]` when the service has no client ID, otherwise `[{ kind: "connect" }]`. This matches the fake. Open question 2 settles what the `client` step draws.
- **`begin(spec)`:**
  - fails with `AuthFailure` `misconfigured` if there's no client ID;
  - generates a 64-character `code_verifier` and its S256 challenge, plus a random `state`;
  - keeps `{ verifier, redirectUri, clientId }` in a server-level map keyed by `(accountId, state)`, for 10 minutes, single use, in memory. A restart loses a half-finished connect, and the user presses Connect again. ⚑ multi-tenancy: the key includes the account, so a state started by one account can't complete for another.
  - returns `{ authoriseUrl }` with `client_id`, `response_type=code`, `redirect_uri`, `code_challenge_method=S256`, `code_challenge`, `state` and `scope` (space-separated from `spec.scopes`).
- **`complete(spec, callback)`:** `callback` is the query the wizard received, as `Record<string, string>`, or a pasted address it was parsed from (open question 1).
  - `error` present (`access_denied` when the user cancels) → reject with a message the wizard shows.
  - Unknown or expired `state` → reject ("start again").
  - Otherwise `POST` the token URL, form-encoded, with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id` and `code_verifier`. Store the grant (open question 6), with `expires_at = now + expires_in`.
- **`resolve(spec)`** (ADR-0013 §5, lazy refresh):
  - no grant → `not-connected`;
  - no client ID → `misconfigured`;
  - the grant was issued to a different client ID, or is marked failed → `reconnect`.
  - Otherwise, if `expires_at` is more than 60 seconds away, return `{ accessToken }`.
  - Else refresh: `POST` the token URL with `grant_type=refresh_token`, `refresh_token` and `client_id`. Store the new access token and expiry. Store a new refresh token if one came back, keep the old one if not, since Spotify says a refresh response "might not include a new refresh token".
  - A `400 invalid_grant` marks the grant failed and rejects `reconnect`. A network error or `5xx` rejects with a plain error: the run fails with `threw`, and the grant is not marked, because the grant isn't at fault.
  - **Single-flight:** concurrent `resolve()` calls for the same account and service share one refresh. Two runs refreshing at once could otherwise each spend a rotating refresh token, and one would lose.
- **The redirect URI** is open question 1.
- **Token hygiene:** no log line, error message or `AuthFailure` contains a token, a verifier or a code.

### The plugin

- **Package:** `packages/plugins/spotify/` (ADR-0014 §6), depending on `@ultrasonics/plugin-sdk` only. HTTP goes through `fetch`; there's no Spotify SDK. `officialPlugins` gains `spotify` with its `path` and `load()` (ADR-0012 §4).
- **Test seam:** the package exports `createSpotifyPlugin({ apiBase })`, and its default export is `createSpotifyPlugin({ apiBase: "https://api.spotify.com/v1" })`. Tests build the plugin against a fake server. There is no environment variable and no test-only branch in the plugin.
- **Handshake:** `name: "spotify"`, `mode: ["playlists"]`, `inputs` as the only component (the output is Phase 2). There are no `persistentSettings`, so the plugin isn't on the settings page (ADR-0019 §6).
- **Auth:** `defineAuth({ service: "spotify", flow: "oauth2-pkce", scopes })`, with the scopes in open question 5. `spotify` is already in the SDK's `services`. **No SDK change.**

### Instance settings (`inputs`)

A `z.discriminatedUnion("source", …)` of three flat objects, inside ADR-0019's renderable subset, drawn as radio cards (ADR-0025 §5). The prototype's union is the starting point. Variants and copy are subject to open questions 3, 4 and 8.

| `source` | Title | Fields |
|---|---|---|
| `chosen` | "playlists i choose" | `playlists`: a non-empty string of Spotify playlist links, URIs or ids, comma-separated. ADR-0019 §3 bans arrays, so a list is a string. |
| `all` | "all my playlists" | `exclude`: an optional string of playlist names, comma-separated, compared case-insensitively. The variant carries `warning` metadata: playlists you only follow can't be read in Spotify's development mode. |
| `liked` | "liked songs" | `name`: a string, default `"liked songs"`, the emitted playlist's name. (Open question 4.) |

- The prototype's `followed` toggle is dropped (open question 3).
- A `chosen` value is parsed with a `.refine()` that accepts `https://open.spotify.com/playlist/<id>` (with or without a query string), `spotify:playlist:<id>`, or a bare 22-character base-62 id. An unparseable entry is an issue on `playlists` (ADR-0019 §5).

### Reading (`run.inputs`)

- **Credentials:** `ctx.auth.get()` before each request, not once per run. The provider returns its cached token until 60 seconds before expiry, so this costs nothing, and a run longer than an access token's one-hour life doesn't hit a 401 (ADR-0010 #7 sets the run deadline at one hour too).
- **Who am I:** `GET /me` once, for the user's id, which the `all` variant needs to tell owned playlists from followed ones.
- **Which playlists:**
  - `chosen`: `GET /playlists/{id}` for each, with `fields` limited to what's emitted, in the order given. Duplicates are read once.
  - `all`: page `GET /me/playlists?limit=50` by `next`. Keep playlists whose `owner.id` is the user, or that are `collaborative`. Drop those named in `exclude`. Log one `info` line with the count of followed playlists left out.
- **Which songs:** page `GET /playlists/{id}/items?limit=50` by `next`, with `fields` limited to each entry's `is_local` and `item(type,id,name,artists(name),album(name,release_date),duration_ms,explicit,external_ids(isrc))`. `liked` pages `GET /me/tracks?limit=50` the same way and emits one playlist.
- **A playlist that can't be read** (`403` or `404` on its details or items) is skipped with a `warn` naming it and the status. Inputs have no result (ADR-0020 §5, Considered options).
- **Mapping a track to a `Song`:**
  - `title`: `name`, trimmed;
  - `artists`: each `artists[].name`, trimmed, blanks dropped;
  - `album`: `album.name`;
  - `date`: `normaliseDate(album.release_date)`;
  - `isrc`: `normaliseIsrc(external_ids.isrc)`;
  - `durationMs`: `duration_ms`;
  - `explicit`;
  - `id`: `{ spotify: id }` when `id` is non-null.
  - Absent or blank values are left out, not sent empty (ADR-0023: "Blank optional fields count as absent").
- **Mapping a playlist:**
  - `name` comes from Spotify.
  - `description` is HTML-unescaped, because Spotify returns entities such as `&#x27;`. It is omitted when blank.
  - `id` is `{ spotify: <playlist id> }`.
  - `songs` follow Spotify's order.
- **Odd items** (must-still-work #5). The plugin cleans them itself, so the runner never has to reject them (ADR-0021 §4):

  | Item | Treatment |
  |---|---|
  | `item` is null | skipped |
  | `item.type` isn't `track` (an episode) | skipped |
  | blank `name` | skipped; the song dict needs a title (ADR-0023) |
  | `is_local` | carried, without an `id` |
  | no artists | carried with `artists: []` |

  Each playlist gets **one** `warn` summarising what was skipped and why, with counts, rather than a line per item. A 10,000-song playlist can't flood the log past ADR-0009's cap.
- **Errors:**
  - `401` throws: the token was refused despite `resolve()`, and ADR-0013 §5 has a plugin that sees a 401 fail the run.
  - `429` is open question 7.
  - Other `5xx` and network errors throw. The input fails, and with it the run (ADR-0020 §5).
  - Every request has a 30-second timeout, as Plex's (#114).
- **`test()`** (ADR-0012 §5): `GET /me` with the grant.
  - 2xx → `{ ok: true }`.
  - 401 → `invalid-credentials`.
  - 403 → `misconfigured`: "this Spotify account isn't on your app's user list. Development mode allows five users, added under User Management."
  - Connection, DNS, TLS or timeout errors → `unreachable`.
  - Anything else → `misconfigured` with the status.

## Testing Decisions

- A good test drives only what is exported: the plugin's `inputs` handler through the SDK harness, `test()`, `runConformance`, and the provider through the Server spec's routes. It asserts on the song dict returned, the log lines, the requests the fake servers received, and the grant read back. Never on internal helpers.
- **The seam is HTTP.** Two fake servers on `Bun.serve`, in-process: the Web API (`createSpotifyPlugin({ apiBase })`) and the accounts service (the provider's injectable endpoint table). They replay JSON fixtures from `test/fixtures/`, written from Spotify's documented shapes and named for the endpoint and case, and record what they receive.
- **`runConformance`** with fixtures for the `inputs` settings (valid: each variant; invalid: an unparseable link, a blank `chosen`, an unknown `source`), credentials `{ accessToken }`, and the fake API. Every invariant passes, including the strict song-dict check and the renderable subset.
- **Handler cases:**
  - `chosen`: links, URIs and bare ids; order kept; a duplicate read once; a 403 and a 404 each skipped with a warning while the rest read.
  - `all`: owned and collaborative kept, followed left out with one count line; `exclude` case-insensitive.
  - `liked`: one playlist with the chosen name (if kept, per open question 4).
  - Paging: three pages of items read in order, by `next`.
  - Mapping: every field; blanks absent; date and ISRC normalised; description unescaped.
  - Odd items: null, episode, blank name, local, and no artists, each handled as in the table, with one summary warning per playlist.
  - Errors: 401 throws; 429 per open question 7; a 5xx throws.
  - No request URL, log line or error contains the token.
  - `test()`: ok, `invalid-credentials`, `misconfigured` on 403, `unreachable`.
- **Provider cases**, through the Server spec's routes, with a real database:
  - `requirements` with and without a client ID;
  - `begin` produces a valid S256 challenge for the stored verifier and the right parameters;
  - `complete` exchanges the code, stores the grant encrypted, and rejects an unknown, reused, expired or other-account `state`;
  - `error=access_denied` is reported;
  - `resolve` returns a fresh token without a request; refreshes when near expiry; keeps the old refresh token when none comes back and stores a rotated one when it does;
  - two concurrent `resolve()` calls make one refresh request;
  - `invalid_grant` marks the grant failed and rejects `reconnect`, and the services list then shows `reconnect`;
  - a changed client ID rejects `reconnect`; a 5xx on refresh fails without marking the grant;
  - no token, code or verifier appears in any log.
- **The exit-gate `/verify`** (#126) is the first contact with real Spotify, through Cal's development-mode app. The fixtures are checked against it then, scrubbed of tokens and personal data.
- Prior art: #114's fake-server approach; `@ultrasonics/plugin-sdk`'s example plugin and conformance tests.

## Out of Scope

- The Spotify **output**, its search helper, and its scopes (Phase 2; must-still-work #6 belongs there).
- `spotify-mixer` (Phase 2). Recommendations are gone for new apps anyway (November 2024).
- Spotify as a login identity (ADR-0008 §5: deferred).
- The `Proxy` provider and the extended-quota application (Phase 5; #100, Out of scope).
- Account-level BYO client IDs (ADR-0013 §7: deferred).
- Scheduled refresh pre-warm (ADR-0013 §5: "explicitly **not Phase 1**").
- The v1 importer's Spotify mapping (Phase 2, ADR-0017 §5).
- Remembering which liked songs were seen before, as v1's saved mode did with a per-applet SQLite file. v2 reads the whole list each run.
- Playlist artwork (v1 #52: a song-dict change, Phase 3).
- Podcasts and episodes as songs.

## Open questions

Each has a recommendation. ⚑ marks a checkpoint.

1. **The redirect URI under Spotify's 2025 rule.** ⚑ auth layer. HTTPS is required except for a loopback IP literal. A self-hoster at `http://192.168.1.50:5000` can't register their own address, which is ADR-0008 §3's finding for login, now true for service auth too. ADR-0013 §8: "The redirect URI in `begin()` is provider-supplied, not derived from the local instance URL."
   - **Recommended:** the provider chooses the URI from the origin the wizard is open on:
     - If that origin is HTTPS, or is itself `127.0.0.1` or `[::1]`, use `<origin>/services/spotify`, and the return lands straight in the wizard.
     - Otherwise use `http://127.0.0.1:<the origin's port>/services/spotify`. After consenting, the browser lands on an address that doesn't load (unless it runs on the server's own machine). The wizard then shows a **paste the address you landed on** box, and posts that address's query to `complete`.
     - In both cases the wizard tells the user to register exactly the URI it shows.
     - `complete(spec, callback: unknown)` already accepts this (ADR-0013 §4), so there is **no SDK change**.
     - The paste box is a change to #118's wizard shell. Recommend #126 builds it, since that ticket first meets the real redirect.
   - Alternatives:
     - Require HTTPS (a reverse proxy) to connect Spotify. That is a hard wall for the self-hosters v1 served.
     - Always use `127.0.0.1` plus paste. Simpler, but worse for HTTPS users.
     - A `PUBLIC_URL` setting. It doesn't help, because the problem is the scheme, not the name.
   - **Edge to note:** under `AUTH_SOURCE=proxy`, a wizard opened at `127.0.0.1` isn't coming through the trusted proxy and gets 401 (ADR-0015 §4). The paste path still works from the proxied origin.
   - **Reading to check:** whether ADR-0013 §8's "not derived from the local instance URL" binds a BYO provider, or only reserves the choice for `Proxy`. This recommendation needs the second reading.
2. **The `client` step's form (#118 Q2).** ⚑ plugin SDK contract and auth layer. `AuthRequirement`'s `client` kind carries no schema (#108).
   - **Recommended:** no SDK change. The provider owns one fixed form per flow, served by the Server spec's `GET /api/services/:service/client-form`. For `oauth2-pkce` that is `{ clientId }`: a non-empty string matching Spotify's 32-hex format, titled "client id". Its description says where to find the value and states the development-mode limits (story 4). **No client secret is ever collected for `oauth2-pkce`** (ADR-0005). An `oauth2` flow with a secret waits until a plugin needs one *and* instance settings can hold a secret encrypted (#109: "Storing an `oauth2` client secret there needs encryption to be decided first").
   - Alternatives: widen `client` to carry a schema (an SDK change, for a form that is the same for every PKCE service); or let `defineAuth` declare client fields (it would encode *how*, against ADR-0013 §1).
3. **Followed playlists, and the `all` variant.** Since February 2026, a development-mode app reads items only from playlists the user owns or collaborates on. The prototype's `all` variant says "every playlist you own or follow", with a `followed` toggle defaulting on.
   - **Recommended:** `all` means owned plus collaborative. The toggle is dropped. The variant carries a `warning` explaining why followed playlists are absent, and the run logs how many were left out.
   - Alternatives: keep the toggle and let each followed playlist fail with a 403 warning (a switch that never works); or list followed playlists as empty (a lie).
   - The `chosen` variant's form description says the same thing.
4. **Liked songs in Phase 1.** The prototype has it, and v1 had a saved mode. The exit gate needs only playlists.
   - **Recommended:** include it. It is one more paged endpoint (`GET /me/tracks`, which the February 2026 guide doesn't touch) and one scope, `user-library-read`.
   - Spotify's documentation doesn't state the order of `/me/tracks`. The plugin should sort by `added_at`, newest first, matching the prototype's warning copy, and say so in that warning.
   - Alternative: defer to Phase 2, which shrinks the scopes to playlists only.
5. **Scopes.** ⚑ auth layer: a scope change later means every grant reconnects. ADR-0013 §1's example lists `playlist-modify-private` because the full plugin will also write.
   - **Recommended:** declare only what the input needs: `playlist-read-private` and `playlist-read-collaborative`, plus `user-library-read` if question 4 keeps liked songs. No v2 user exists before Phase 4's release, so Phase 2 widening the scopes costs nothing real. Store the granted `scope` string in the grant, so that when the output adds scopes, `resolve()` can tell a narrower grant and answer `reconnect` instead of failing with a 403.
   - Alternative: request the write scopes now, so Phase 2 never has to detect a narrow grant. That asks a Phase 1 user for write access the app doesn't use.
6. **The grant document, failure marking and refresh rotation.** ⚑ auth layer and stored data (no schema change: `credentials.secret` is an encrypted JSON document, #109).
   - **Recommended:** the `oauth2-pkce` grant document is `{ accessToken, refreshToken, scope, clientId, failed? }`, where `failed` is `{ at, message }`. `expires_at` stays in the clear (ADR-0009 §6).
     - `clientId` binds the grant to the app that issued it. A refresh token "only works for the app that issued it" (ADR-0017, Context), so changing the client ID turns every grant into `reconnect` rather than an opaque refresh error.
     - `failed` is set only on `invalid_grant`, and cleared by a successful `complete`. The services list reads it without a network call (Server spec, open question 6).
     - Rotation is handled as in Implementation Decisions.
   - Alternative: delete the grant on `invalid_grant`. Simpler, but the services list then shows "not connected" instead of the magenta "reconnect" #118 story 45 asks for.
7. **Rate limits (429).** Spotify counts over a rolling 30 seconds and answers `429` with `Retry-After` in seconds. Development-mode limits are unpublished and "much lower". ADR-0018 §4: "No automatic retries in Phase 1 (v1 #12). Retrying only transient failures would need plugins to classify their errors, which is a plugin SDK change." That sentence is about re-running a failed *run*. It argues for the cheaper option here, so check it before applying it to one HTTP request.
   - **Recommended:** the plugin's HTTP client waits `Retry-After` and retries that request, up to three times and 120 seconds in total per run, logging each wait at `info`. Past that it throws. This needs no SDK change and no error classification by the runner.
   - Alternative: throw on the first 429. The run fails, and the next scheduled firing is the retry. On a large `all` read in development mode, that could fail every time.
8. **Choosing playlists by link or by name.** The fake catalogue asks for names ("discover weekly, release radar"). The prototype asks for links.
   - **Recommended:** links, URIs or ids, because names repeat and ADR-0020 §2 chose positions over names for the same reason. `exclude` in `all` stays by name, because it filters a list the user can see.
   - Alternative: names, as v1 did, with an ambiguity warning.
   - Either way the fake's placeholder should change: Discover Weekly and Release Radar are Spotify-owned algorithmic playlists, which new apps can't read.

## Further Notes

- **Tickets: one**, as #100 planned. It is sized for `/code-review`: one plugin package and one flow added to an existing class. It is blocked by the Server spec's ticket 1, which creates `LocalAuthProvider`, the operator-settings file and the service routes, and by #113 (the registry), which is delivered. It doesn't need the matcher.

  **Ticket: the Spotify input and the `oauth2-pkce` flow.**

  - [ ] `LocalAuthProvider` implements `oauth2-pkce`: requirements, `begin` with S256 and an account-keyed single-use `state`, `complete`, and lazy single-flight refresh with rotation, exactly as above. The endpoint table is injectable.
  - [ ] The client form and the redirect URI follow open questions 1 and 2. No change to `@ultrasonics/plugin-sdk`.
  - [ ] The grant document follows open question 6. `invalid_grant` and a changed client ID answer `reconnect`, and network errors don't mark the grant.
  - [ ] `packages/plugins/spotify` exists with `createSpotifyPlugin`, registered as `spotify` in `officialPlugins`.
  - [ ] The `inputs` settings are the union above, as settled by open questions 3, 4 and 8, inside the renderable subset.
  - [ ] The handler reads, pages, maps and skips as specified, with one summary warning per playlist and 429 handled per open question 7.
  - [ ] `test()` returns the four outcomes above.
  - [ ] `runConformance` passes. The handler and provider cases above pass against the fake servers. No token, code or verifier reaches a log.
  - [ ] `bun run test` and `bun run check` are green across the workspace.

  The wizard's paste box (open question 1) goes to #126, if Cal agrees, so this ticket stays out of `packages/web`.

- **Decided here, worth a glance:**
  - Service endpoints live in a server-side table, not in `defineAuth`.
  - A verifier is 64 characters, and `state` lives 10 minutes, single use, in memory.
  - Refresh happens 60 seconds before expiry, single-flight.
  - The plugin calls `ctx.auth.get()` per request, not per run.
  - There is one summary warning per playlist, not one per item.
  - Playlist descriptions are HTML-unescaped.
  - Local files are carried without an id, and episodes are skipped.
  - `createSpotifyPlugin({ apiBase })` is the test seam.
  - Requests omit `market`, relying on the user's token.
- **For Cal, beyond this spec:**
  - **The hosted tier's Spotify plan rests on extended quota** (ADR-0002, and the roadmap's early track). Since 15 May 2025, only organisations with at least 250,000 MAU may apply. Self-host is unaffected, because every self-hoster runs their own app. ADR-0013 §7 already names the fallback for hosted, account-level BYO ("the natural fallback if the Spotify platform-access wall found by ticket 014 bites the hosted tier"). This is worth a fresh look before Phase 5, not in this spec.
  - **ADR-0025 §3's example sentence** ("take discover weekly from spotify") names a playlist v2 cannot read. Change the example, not the decision.
  - **Development mode's five-user cap** means one Spotify app serves at most five people's accounts. That suits self-host (one account per install, ADR-0015 §5).
- **No change to the plugin SDK contract** if open questions 1, 2 and 5 land as recommended. If the build finds it needs one, it stops and asks (AGENTS.md).
- **Spotify sources**, read 16 November 2026:
  - [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
  - [Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)
  - [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
  - [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
  - [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
  - [Developer access update, February 2026](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
  - [Web API changes, November 2024](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
  - [Get Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items)
  - [Get User's Saved Tracks](https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks)
  - [Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)

  Two points were uncertain in the sources. Spotify postponed the endpoint changes for *existing* apps without a new date, but new apps (every self-hoster's) are bound now. The ISRC in `external_ids` was listed as removed in February 2026 and restored in March. Both are rechecked at `/verify`.
