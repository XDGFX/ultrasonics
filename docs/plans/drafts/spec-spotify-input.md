# Spec: the Spotify input plugin and the PKCE provider

Part of [Phase 1 specs](https://github.com/XDGFX/ultrasonics/issues/100), spec 5 of 8. Builds on [Spec: the plugin SDK and AuthProvider types](https://github.com/XDGFX/ultrasonics/issues/108), [Spec: the runner, run queue and run events](https://github.com/XDGFX/ultrasonics/issues/110) and [Spec: the server, its HTTP API, the run stream, the scheduler and the webhook](SERVER_SPEC_URL), whose `LocalAuthProvider` this spec extends with the `oauth2-pkce` flow. Settles open question 2 of [Spec: the Vue UI and the settings-form renderer](https://github.com/XDGFX/ultrasonics/issues/118).

Cal grilled this spec on 16 November 2026 and accepted every recommendation. The answers are under "Decisions from the grilling" in Implementation Decisions. Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md); each was settled in that grilling.

The Spotify facts below come from Spotify's developer documentation, read and checked on 16 November 2026. The sources are at the end, because several changed during 2025 and 2026.

## Problem Statement

Spotify is the near end of the exit gate: "a real Spotify playlist syncs to Plex through the UI". v2 has no Spotify plugin, and no `AuthProvider` can complete an OAuth flow.

v1's Spotify input broke every new install when the `ultrasonics-api` proxy holding its secret died in November 2022 (ADR-0005; v1 #61). It also broke on odd playlist items: local files have a null `id`, removed and unavailable items come back as a null track, and v1's error handler itself crashed on one (must-still-work #5; v1 #29, #30). A track with a blank name reached Plex with no `title` (#38).

Spotify has since narrowed what a self-hoster's app may do:

- **Redirect URIs (from 9 April 2025).** A redirect URI must use HTTPS unless it is a loopback IP literal (`http://127.0.0.1:PORT` or `http://[::1]:PORT`). `localhost` is refused. A LAN address such as `http://192.168.1.50:5000` cannot be registered at all.
- **Development mode (February and March 2026).**
  - An app allows **five** users, each allowlisted by hand.
  - The owner needs **Premium**.
  - A playlist's items can be read **only if the user owns or collaborates on it**. Any other playlist answers 403. This binds apps created after 11 February 2026, which every new self-hoster's app is; Spotify postponed it for existing integrations.
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
3. As a self-hoster who reaches ultrasonics at a LAN address, I want to finish connecting by pasting the address Spotify sent me to, even though Spotify won't accept my LAN address as a redirect URI.
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
14. As a user, I want my Liked Songs read as one playlist with a name I choose, newest first.

**Reading**

15. As a user, I want each playlist emitted with its Spotify name, its description and its Spotify id.
16. As a user, I want each song to carry its title, artists, album, release date, ISRC, duration, explicit flag and Spotify id, so that the matcher has the strongest keys available (ADR-0023).
17. As a user, I want songs in the order Spotify holds them.
18. As a user, I want a local file in a playlist carried with its title and artists and no Spotify id, with a warning, so that it can still match on the other side (must-still-work #5).
19. As a user, I want a removed or unavailable item, an episode, or an item with no title skipped with a warning while the rest of the playlist reads, so that one odd item never aborts a run (must-still-work #2, #5; v1 #29, #38).
20. As a user, I want a song with no artists carried with an empty artist list, which the song dict allows (ADR-0023).
21. As a user, I want a chosen playlist I can't read (deleted, private to someone else, or only followed) skipped with a warning naming it, while the others read (ADR-0020: "an input's skips go through `ctx.log`").
22. As a user with a 2,000-song playlist, I want every song read, page by page.
23. As a user, I want a Spotify rate limit to slow the run down, not fail it, within a bound.
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

The class and its home are the server spec's (its grilling decision 6). This spec adds the flow.

- **Service endpoints are server-side data,** not SDK declarations: a table from `Service` to `{ authoriseUrl, tokenUrl }`, with Spotify's `https://accounts.spotify.com/authorize` and `/api/token`. `defineAuth` stays as ADR-0013 §1 has it ("it never encodes *how* the credentials are obtained"). The table's URLs are injectable so tests point them at a fake.
- **The operator's client** is `{ clientId }`, read and written through the server spec's `operator-settings.ts` (its grilling decision 5), under the key `oauth-client:<service>`.
- **`requirements(spec)`:** `[{ kind: "client", service }, { kind: "connect" }]` when the service has no client ID, otherwise `[{ kind: "connect" }]`. This matches the fake. The `client` step draws the fixed form from `GET /api/services/:service/client-form` (decision 2).
- **`begin(spec)`:**
  - fails with `AuthFailure` `misconfigured` if there's no client ID;
  - generates a 64-character `code_verifier` and its S256 challenge, plus a random `state`;
  - keeps `{ verifier, redirectUri, clientId }` in a server-level map keyed by `(accountId, state)`, for 10 minutes, single use, in memory. A restart loses a half-finished connect, and the user presses Connect again. ⚑ multi-tenancy: the key includes the account, so a state started by one account can't complete for another.
  - returns `{ authoriseUrl }` with `client_id`, `response_type=code`, `redirect_uri`, `code_challenge_method=S256`, `code_challenge`, `state` and `scope` (space-separated from `spec.scopes`).
- **`complete(spec, callback)`:** `callback` is the query the wizard received, as `Record<string, string>`, or the query of an address the user pasted (decision 1).
  - `error` present (`access_denied` when the user cancels) → reject with a message the wizard shows.
  - Unknown or expired `state` → reject ("start again").
  - Otherwise `POST` the token URL, form-encoded, with `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id` and `code_verifier`. Store the grant document (decision 6), with `expires_at = now + expires_in`. A successful `complete` replaces any earlier grant, which clears `failed`.
- **`resolve(spec)`** (ADR-0013 §5, lazy refresh):
  - no grant → `not-connected`;
  - no client ID → `misconfigured`;
  - the grant was issued to a different client ID, is marked failed, or its stored `scope` lacks a scope `spec.scopes` now declares → `reconnect`.
  - Otherwise, if `expires_at` is more than 60 seconds away, return `{ accessToken }`.
  - Else refresh: `POST` the token URL with `grant_type=refresh_token`, `refresh_token` and `client_id`. Store the new access token and expiry. Store a new refresh token if one came back, keep the old one if not, since Spotify says a refresh response "might not include a new refresh token".
  - A `400 invalid_grant` marks the grant failed and rejects `reconnect`. A network error or `5xx` rejects with a plain error: the run fails with `threw`, and the grant is not marked, because the grant isn't at fault.
  - **Single-flight:** concurrent `resolve()` calls for the same account and service share one refresh. Two runs refreshing at once could otherwise each spend a rotating refresh token, and one would lose.
- **The redirect URI** follows decision 1: `<origin>/services/spotify` when the wizard's origin is HTTPS, `127.0.0.1` or `[::1]`, otherwise `http://127.0.0.1:<port>/services/spotify` with the paste box.
- **Token hygiene:** no log line, error message or `AuthFailure` contains a token, a verifier or a code.

### The plugin

- **Package:** `packages/plugins/spotify/` (ADR-0014 §6), depending on `@ultrasonics/plugin-sdk` only. HTTP goes through `fetch`; there's no Spotify SDK. `officialPlugins` gains `spotify` with its `path` and `load()` (ADR-0012 §4).
- **Test seam:** the package exports `createSpotifyPlugin({ apiBase })`, and its default export is `createSpotifyPlugin({ apiBase: "https://api.spotify.com/v1" })`. Tests build the plugin against a fake server. There is no environment variable and no test-only branch in the plugin.
- **Handshake:** `name: "spotify"`, `mode: ["playlists"]`, `inputs` as the only component (the output is Phase 2). There are no `persistentSettings`, so the plugin isn't on the settings page (ADR-0019 §6).
- **Auth:** `defineAuth({ service: "spotify", flow: "oauth2-pkce", scopes })`, with `playlist-read-private`, `playlist-read-collaborative` and `user-library-read` (decision 5). `spotify` is already in the SDK's `services`. **No SDK change.**

### Instance settings (`inputs`)

A `z.discriminatedUnion("source", …)` of three flat objects, inside ADR-0019's renderable subset, drawn as radio cards (ADR-0025 §5). The prototype's union is the starting point, changed by decisions 3, 4 and 8.

| `source` | Title | Fields |
|---|---|---|
| `chosen` | "playlists i choose" | `playlists`: a non-empty string of Spotify playlist links, URIs or ids, comma-separated. ADR-0019 §3 bans arrays, so a list is a string. |
| `all` | "all my playlists" | `exclude`: an optional string of playlist names, comma-separated, compared case-insensitively. The variant carries `warning` metadata: playlists you only follow can't be read in Spotify's development mode. |
| `liked` | "liked songs" | `name`: a string, default `"liked songs"`, the emitted playlist's name. The variant's `warning` says songs come newest first, by when they were liked. |

- The prototype's `followed` toggle is dropped (decision 3). The `chosen` variant's description also says followed playlists can't be read.
- A `chosen` value is parsed with a `.refine()` that accepts `https://open.spotify.com/playlist/<id>` (with or without a query string), `spotify:playlist:<id>`, or a bare 22-character base-62 id. An unparseable entry is an issue on `playlists` (ADR-0019 §5).

### Reading (`run.inputs`)

- **Credentials:** `ctx.auth.get()` before each request, not once per run. The provider returns its cached token until 60 seconds before expiry, so this costs nothing, and a run longer than an access token's one-hour life doesn't hit a 401 (ADR-0010 #7 sets the run deadline at one hour too).
- **Who am I:** `GET /me` once, for the user's id, which the `all` variant needs to tell owned playlists from followed ones.
- **Which playlists:**
  - `chosen`: `GET /playlists/{id}` for each, with `fields` limited to what's emitted, in the order given. Duplicates are read once.
  - `all`: page `GET /me/playlists?limit=50` by `next`. Keep playlists whose `owner.id` is the user, or that are `collaborative`. Drop those named in `exclude`. Log one `info` line with the count of followed playlists left out.
- **Which songs:** page `GET /playlists/{id}/items?limit=50` by `next`, with `fields` limited to each entry's `is_local` and `item(type,id,name,artists(name),album(name,release_date),duration_ms,explicit,external_ids(isrc))`. `liked` pages `GET /me/tracks?limit=50` the same way, sorts by `added_at` newest first, and emits one playlist.
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
  - `429` waits out `Retry-After` and retries that request, at most three times and 120 seconds in total per run, logging each wait at `info`. Past either bound it throws (decision 7).
  - Other `5xx` and network errors throw. The input fails, and with it the run (ADR-0020 §5).
  - Every request has a 30-second timeout, as Plex's (#114).
- **`test()`** (ADR-0012 §5): `GET /me` with the grant.
  - 2xx → `{ ok: true }`.
  - 401 → `invalid-credentials`.
  - 403 → `misconfigured`: "this Spotify account isn't on your app's user list. Development mode allows five users, added under User Management."
  - Connection, DNS, TLS or timeout errors → `unreachable`.
  - Anything else → `misconfigured` with the status.

### Decisions from the grilling (Cal, 16 November 2026)

The draft carried each of these as an open question with a recommendation. Cal accepted all eight. ⚑ marks a checkpoint.

1. **The redirect URI under Spotify's 2025 rule.** ⚑ auth layer. The provider chooses the URI from the wizard's origin, which the server spec's redirect-uri route passes it (server spec, grilling decision 2):
   - If that origin is HTTPS, or is itself `127.0.0.1` or `[::1]`, the URI is `<origin>/services/spotify`, and the return lands straight in the wizard.
   - Otherwise it is `http://127.0.0.1:<the origin's port>/services/spotify`. After consenting, the browser lands on an address that doesn't load, unless the browser runs on the server's own machine. The wizard shows a box to paste the address it landed on, and posts that address's query to `complete`.
   - In both cases the wizard tells the user to register exactly the URI it shows.
   - `complete(spec, callback: unknown)` already accepts a pasted query (ADR-0013 §4). **No SDK change.**
   - **#126 builds the paste box**, a change to #118's wizard shell, because that ticket first meets the real redirect.
   - Under `AUTH_SOURCE=proxy`, a wizard opened at `127.0.0.1` doesn't come through the trusted proxy and gets `401` (ADR-0015 §4). The paste path still works from the proxied origin.
   - This reads ADR-0013 §8 as reserving the choice to the provider, not as forbidding a BYO provider from using the instance's origin; Cal confirmed that reading in the server spec's grilling.
   - Rejected: requiring HTTPS through a reverse proxy, a hard wall for the self-hosters v1 served; always using `127.0.0.1` plus paste, worse for HTTPS users; a `PUBLIC_URL` setting, which doesn't help because the problem is the scheme, not the name.
2. **The `client` step's form** (#118 open question 2). ⚑ plugin SDK contract and auth layer. The provider serves one fixed form per flow from `GET /api/services/:service/client-form`. For `oauth2-pkce` it is `{ clientId }`: 32 hex characters, Spotify's format, titled "client id". Its description says where to find the value and states development mode's limits (story 4). **No client secret is ever collected for PKCE** (ADR-0005: "no client secret is stored at all"). An `oauth2` flow with a secret waits until a plugin needs one and instance settings can hold a secret encrypted (#109). **No SDK change.** Rejected: widening `client` to carry a schema, an SDK change for a form that is the same for every PKCE service; letting `defineAuth` declare client fields, which would encode *how*, against ADR-0013 §1.
3. **Followed playlists, and the `all` variant.** "All my playlists" means owned plus collaborative. The prototype's `followed` toggle is dropped. The variant's `warning` explains why followed playlists are absent, the `chosen` variant's description says the same, and the run logs how many playlists it excluded. Rejected: keeping the toggle and letting each followed playlist fail with a 403 warning, a switch that never works; listing followed playlists as empty, which is a lie.
4. **Liked songs are in Phase 1**, read from `GET /me/tracks` and sorted by `added_at`, newest first. Spotify's documentation doesn't state the endpoint's order, so the plugin sorts, and the variant's `warning` says so. It costs one paged endpoint and one scope. Rejected: deferring to Phase 2.
5. **Scopes.** ⚑ auth layer. `playlist-read-private`, `playlist-read-collaborative` and `user-library-read`, and nothing else. The grant stores the granted `scope` string, so when Phase 2's output adds write scopes, `resolve()` sees a narrower grant and answers `reconnect` instead of the run failing with a 403. No v2 user exists before Phase 4's release, so widening later costs nothing real. Rejected: asking for write scopes now, which asks a Phase 1 user for access the app doesn't use. ADR-0013 §1's example lists `playlist-modify-private` for the full plugin; that stays an example.
6. **The grant document.** ⚑ auth layer and stored data, with no schema change: `credentials.secret` is an encrypted JSON document (#109). The `oauth2-pkce` grant is `{ accessToken, refreshToken, scope, clientId, failed? }`, with `failed` as `{ at, message }`. `expires_at` stays in the clear (ADR-0009 §6).
   - `clientId` binds the grant to the app that issued it. A refresh token only works for the app that issued it (ADR-0017, Context), so changing the client ID turns every grant into `reconnect` rather than an opaque refresh error.
   - `failed` is set only on `invalid_grant`, and cleared by a successful `complete`. The services list reads it without a network call (server spec, grilling decision 6).
   - Rejected: deleting the grant on `invalid_grant`. The services list would then show "not connected" instead of the magenta "reconnect" #118 story 45 asks for.
7. **Rate limits.** On a `429`, the plugin's HTTP client waits out `Retry-After` and retries that request, at most three times and 120 seconds in total per run, logging each wait at `info`. Past that it throws. No SDK change, and the runner classifies nothing. ADR-0018 §4's "No automatic retries in Phase 1" is about re-running a failed *run*, and doesn't bind one HTTP request. Rejected: throwing on the first `429`, which on a large `all` read in development mode, whose limits Spotify calls "much lower" and doesn't publish, could fail every time.
8. **Playlists are chosen by link, URI or id**, because names repeat; ADR-0020 §2 chose positions over names for the same reason. `exclude` in `all` stays by name, because it filters a list the user can see. The web fake's Spotify entry asks for names, with Discover Weekly and Release Radar as placeholders, which new apps can't read; this spec's ticket changes it to `playlists` by link. Rejected: names, as v1 did, with an ambiguity warning.

## Testing Decisions

- A good test drives only what is exported: the plugin's `inputs` handler through the SDK harness, `test()`, `runConformance`, and the provider through the Server spec's routes. It asserts on the song dict returned, the log lines, the requests the fake servers received, and the grant read back. Never on internal helpers.
- **The seam is HTTP.** Two fake servers on `Bun.serve`, in-process: the Web API (`createSpotifyPlugin({ apiBase })`) and the accounts service (the provider's injectable endpoint table). They replay JSON fixtures from `test/fixtures/`, written from Spotify's documented shapes and named for the endpoint and case, and record what they receive.
- **`runConformance`** with fixtures for the `inputs` settings (valid: each variant; invalid: an unparseable link, a blank `chosen`, an unknown `source`), credentials `{ accessToken }`, and the fake API. Every invariant passes, including the strict song-dict check and the renderable subset.
- **Handler cases:**
  - `chosen`: links, URIs and bare ids; order kept; a duplicate read once; a 403 and a 404 each skipped with a warning while the rest read.
  - `all`: owned and collaborative kept, followed left out with one count line; `exclude` case-insensitive.
  - `liked`: one playlist with the chosen name, newest `added_at` first.
  - Paging: three pages of items read in order, by `next`.
  - Mapping: every field; blanks absent; date and ISRC normalised; description unescaped.
  - Odd items: null, episode, blank name, local, and no artists, each handled as in the table, with one summary warning per playlist.
  - Errors: 401 throws; a 429 with `Retry-After` is waited out and retried with an `info` line; a fourth 429, or waits past 120 seconds in a run, throws; a 5xx throws. The tests inject the clock or the sleep, so no test waits in real time.
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
  - a changed client ID, or a stored `scope` narrower than the declared scopes, rejects `reconnect`; a 5xx on refresh fails without marking the grant; a later successful `complete` clears `failed`;
  - the redirect URI is `<origin>/services/spotify` for an HTTPS, `127.0.0.1` or `[::1]` origin, and `http://127.0.0.1:<port>/services/spotify` for a LAN origin; `complete` accepts the query parsed from a pasted address;
  - the client form is `{ clientId }`, rejects anything but 32 hex characters, and has no secret field;
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
- A toggle for followed playlists. Development mode can't read their items (decision 3).
- Write scopes. Phase 2's output adds them, and a grant without them then resolves to `reconnect` (decision 5).

## Further Notes

- **Tickets: one**, as #100 planned, sized for `/code-review`: one plugin package and one flow added to an existing class. It is blocked by the server spec's ticket 1, which creates `LocalAuthProvider`, `operator-settings.ts` and the service routes. #113 (the registry) is delivered. It doesn't need the matcher. In `packages/web` it changes only the fake's Spotify entry and the dev seed (decision 8); #126 builds the wizard's paste box.
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
- **No change to the plugin SDK contract.** Decisions 1, 2 and 5 need none. If the build finds it needs one, it stops and asks (AGENTS.md).
- **Beyond this spec:**
  - **The hosted tier's Spotify plan rests on extended quota** (ADR-0002, and the roadmap's early track). Extended quota is now for organisations with at least 250,000 monthly users only. Self-host is unaffected, because every self-hoster runs their own app. Filed for triage as HOSTED_ISSUE.
  - **ADR-0025 §3's example sentence** ("take discover weekly from spotify") names a playlist v2 cannot read. Change the example, not the decision.
  - **Development mode's five-user cap** means one Spotify app serves at most five people. That suits self-host (one account per install, ADR-0015 §5).
  - **For Phase 2's output:** in development mode, search's `limit` is now at most 10, and batch endpoints such as `GET /tracks?ids=` and `GET /users/{id}/playlists` are gone.
- **Spotify facts checked on 16 November 2026:**
  - Redirect URIs must be HTTPS unless they are a loopback IP literal: [Increasing the security requirements for integrating with Spotify](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify) (February 2025).
  - Development mode needs Premium, allows five users, and reads items only from playlists the user owns or collaborates on. The playlist rule binds apps created after 11 February 2026 and is postponed for existing integrations: [Update on developer access and platform security](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) (February 2026).
  - Extended quota is for organisations with at least 250,000 monthly active users: [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
  - Search's `limit` is at most 10, and batch endpoints such as `GET /tracks?ids=` and `GET /users/{id}/playlists` are removed in development mode: [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
- **Other Spotify sources**, read 16 November 2026:
  - [Authorization Code with PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
  - [Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)
  - [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)
  - [Web API changes, November 2024](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
  - [Get Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items)
  - [Get User's Saved Tracks](https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks)
  - [Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)

  One point stays uncertain: the ISRC in `external_ids` was listed as removed in February 2026 and restored in March. `/verify` rechecks it.
