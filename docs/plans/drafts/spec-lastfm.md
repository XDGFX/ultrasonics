# Spec: the Last.fm input

Draft for grilling. Phase 2 (plugin parity). Builds on ADR-0013 §1, which already names Last.fm's grant: "`flow: "token"` with a single `apiKey` field". Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md).

Last.fm facts were read from Last.fm's API pages on 16 November 2026. Nothing was called with a key, because none was available; the response shapes are the method pages' and get checked in `/verify`.

## Problem Statement

v1's `lastfm` input turned a user's listening history into a playlist: loved tracks, top tracks over a period, or scrobbles in a time window. It never held a key of its own. It called ultrasonics-api's `/lastfm` route, which added the proxy's key, so it died with the proxy in November 2022 (ADR-0013, Context: "a second broken proxy path, just less visible than Spotify's").

Its other faults:

- It put the track's Last.fm **URL** in `id.lastfm`. ADR-0023 §2 says an id value is a bare id, never a URL, and Last.fm has no track id to give.
- The `limit` field was free text read with `int()`, so a blank or a typo crashed the run, the same class of bug as #47.
- On a 429 it slept 60 seconds once and then failed. Last.fm reports its rate limit as error 29 inside the body, which v1 never read.
- Recent tracks kept every scrobble, so a song played twenty times appeared twenty times.

## Solution

A new plugin, `lastfm`, in its own package, with an `inputs` component in `songs` mode. The user pastes their own Last.fm API key once (a `token` flow, ADR-0013 §1), and each applet names a Last.fm username and what to read. The plugin emits one playlist.

Reading needs only the API key: the three `user.get…Tracks` methods each say "This service does **not** require authentication". No session key, no shared secret and no web auth flow are needed.

## User Stories

1. As a self-hoster, I want to create a Last.fm API key and paste it once, so that Last.fm works without a hosted proxy.
2. As a user, I want the key entered as a secret that is never shown back to me.
3. As a user, I want "test" to tell me whether the key was refused or Last.fm was unreachable.
4. As a user, I want to name the Last.fm user to read per applet, so that one key reads my history and a friend's public one.
5. As a user, I want my loved tracks as a playlist, newest first.
6. As a user, I want my top tracks over a period I choose (all time, 7 days, 1, 3, 6 or 12 months).
7. As a user, I want the tracks I scrobbled in a window I choose, each song once, most recent first.
8. As a user, I want to cap how many songs are read, with a number field that can't crash a run when left blank (must-still-work #3).
9. As a user, I want to name the playlist the songs arrive in.
10. As a user, I want the track playing right now left out of recent tracks.
11. As a user, I want each song to carry its title, artist, and album and length where Last.fm has them, so that outputs can match it.
12. As a user, I want a username that doesn't exist to fail the run with a message saying so.
13. As a user, I want Last.fm's rate limit to slow the run, not fail it, within a bound.
14. As a user, I want my API key kept out of every log line and stored error.
15. As a v1 user, I want my Last.fm applets imported with their settings, and told to supply an API key (ADR-0017 §6).
16. As a maintainer, I want the plugin tested offline against a fake Last.fm API.

## Implementation Decisions

### Package and handshake

- `packages/plugins/lastfm/` (ADR-0014 §6), depending on `@ultrasonics/plugin-sdk` only. `createLastfmPlugin({ apiBase, sleep })` is the test seam (#136). `officialPlugins` gains `lastfm`.
- `name: "lastfm"`, `mode: ["songs"]`, `inputs` only. A songs-mode input contributes one playlist (GLOSSARY, **Mode**). No `persistentSettings` (open question 1).

### Service auth ⚑ checkpoint: plugin SDK contract (service registry)

- `defineAuth({ service: "lastfm", flow: "token", fields: z.object({ apiKey }) })`, with `apiKey` a 32-character hex string carrying `secret` metadata (ADR-0019 §2), a title, and a description pointing at `last.fm/api/account/create`. This is ADR-0013 §1's declaration as written.
- `lastfm` joins `services` in `packages/plugin-sdk/src/service.ts`. The file's own comment says each port adds its service there, and `runConformance` checks it (ADR-0013 §2). It is still an edit to the SDK package, so it's flagged.
- `LocalAuthProvider` already handles `token` flows (`requirements` returns the fields form, `configure` stores the grant). **No provider change.** The server spec's `configure` route tests the candidate key before storing it (#134, grilling decision 3), so `test()` must work from the grant alone.
- A grant is per account (ADR-0009 §6). On the hosted tier each account would paste its own key unless a `Proxy` provider supplies one (ADR-0013 §8); open question 4.

### Instance settings (`inputs`)

A `z.discriminatedUnion("select", …)` of flat objects (ADR-0019 §3). Every variant repeats three fields, because a union of flat objects is the subset's only conditional shape:

- `username`: non-empty string, the Last.fm user to read.
- `limit`: integer, 1 to 1,000, default 50. A blank is absent and takes the default (ADR-0019 §5), which closes v1's `int('')` crash.
- `name`: string, default `"last.fm songs"`, the emitted playlist's name.

| `select` | Title | Extra fields |
|---|---|---|
| `loved` | "loved tracks" | none |
| `top` | "top tracks" | `period`: `overall`, `7day`, `1month`, `3month`, `6month`, `12month`, default `overall`, with labels "all time", "7 days" and so on. These are Last.fm's own values. |
| `recent` | "recent tracks" | `ending`: `now`, `7d`, `1m`, `3m`, `6m`, `1y`, `2y` ago, default `now`; `span`: `1d`, `7d`, `1m`, `3m`, `6m`, `1y`, default `7d`. v1's two selects, kept. |

### Reading (`run.inputs`)

- **Requests:** `GET <apiBase>?method=…&user=…&api_key=…&format=json&limit=<page>&page=<n>`. The key travels in the query string, as Last.fm requires, so the client never logs a request URL, only the method name. Every request sends a fixed, identifiable `User-Agent` (`ultrasonics/<version>`), as Last.fm's API introduction asks. 30-second timeout.
- **Pacing:** at most one request every 250 ms. Last.fm's introduction warns that an account "may be suspended if your application is continuously making several calls per second", and publishes no number. Four a second at the most is below "several" on any reading, and a 1,000-song read is five page requests.
- **Methods:**
  - `loved`: `user.getLovedTracks`, newest first as Last.fm returns it.
  - `top`: `user.getTopTracks&period=<period>`, in rank order.
  - `recent`: `user.getRecentTracks&from=<uts>&to=<uts>`, computed from `ending` and `span` against the run's clock, with months as 30.44 days and years as 365.25 days, v1's figures. An item with `@attr.nowplaying` is skipped. Repeats are dropped, keeping each song's most recent scrobble (open question 2).
- **Paging:** `limit=200` (the documented maximum for recent tracks; the others state none) until `limit` songs are read or `@attr.totalPages` is reached.
- **Mapping to a `Song`:**
  - `title`: `name`, trimmed. Blank: skipped.
  - `artists`: `[artist.name ?? artist["#text"]]`, blanks dropped.
  - `album`: `album["#text"]` where present (recent tracks only).
  - `durationMs`: top tracks give `duration` in seconds; `"0"` or absent is absent.
  - `id`: none. The URL isn't an id (ADR-0023 §2). Last.fm's `mbid` is often empty and isn't documented as a recording MBID, so it isn't carried as `id.musicbrainz` (the same caution as the Plex input's `mbid://` finding).
- **No per-song enrichment.** v1 called `track.getInfo` for each song without an album. Loved and top tracks never carry one, so that was a request per song for every loved or top read. Open question 3.
- **The playlist:** `{ name, songs }`, no `id`, no `description`.
- **Errors** (Last.fm puts a code in the body, often with a 4xx status):
  - `6` (user not found): throw, with "No Last.fm user is called <username>".
  - `10` or `26` (invalid or suspended key): throw, with a message telling the user to re-enter the key.
  - `29` (rate limit) or HTTP `429`: wait 10 seconds and retry, at most three times and 120 seconds per run, logging each wait at `info`. Past that it throws (#136 decision 7's shape).
  - `8`, `11` or `16` (temporary): one retry after 5 seconds, then throw.
  - Anything else, a non-JSON body or a network error: throw.
- One `info` line: the method, the user, songs read, repeats dropped.

### `test()` (ADR-0012 §5)

`test()` has no instance settings, so there's no username. It calls `chart.getTopArtists&limit=1`, which needs only a key.

- Success → `{ ok: true }`.
- `10` or `26` → `invalid-credentials`.
- Connection, DNS, TLS or timeout → `unreachable`.
- Anything else → `misconfigured` with Last.fm's message.

### v1 import mapping (ADR-0017 §5)

| v1 `lastfm` | v2 `lastfm` |
|---|---|
| global `username` | `username` on each imported Last.fm applet. |
| `select` `Loved Tracks` / `Top Tracks` / `Recent Tracks` | `select` `loved` / `top` / `recent` |
| `limit` | an integer from 1 to 1,000. Blank or not a whole number: absent, so 50, and the report says so for that applet. |
| `period` `Overall`, `7 Days`, `1 Month`, `3 Months`, `6 Months`, `12 Months` | `overall`, `7day`, `1month`, `3month`, `6month`, `12month` |
| `period-end` `Now`, `7 Days Ago` … `2 Years Ago` | `ending` `now`, `7d` … `2y` |
| `period-duration` `1 Day` … `1 Year` | `span` `1d` … `1y` |
| `playlist_title` | `name`. Blank: v1's runtime default, `"Last.fm Music"`. |
| API key | None existed. The report asks for one (ADR-0017 §6). |

Tested against a v1 fixture with one applet per `select`, one with a blank `limit` and one with a non-numeric `limit`.

### v1 behaviour dropped

- The Last.fm URL as `id.lastfm`.
- Free-text `limit` parsed with `int()`.
- The single 60-second sleep on HTTP 429, blind to error 29.
- A `track.getInfo` request per song.
- Repeated scrobbles kept as repeated songs (open question 2).

## Open questions

1. **Where does `username` live?** v1 kept it as a global setting.
   - **Recommendation:** an instance setting, as above. The key identifies the developer, not the listener, so one key reading several users is how Last.fm is meant to be used, and an applet that reads a friend's loved tracks needs it per applet. The importer copies v1's global value onto each applet.
   - Alternative: `persistentSettings`, one username per account, which matches v1 and puts Last.fm on the plugin settings page (ADR-0019 §6).
   - Not an option: a grant field. ADR-0012 §6's rule is "if you cannot open an authenticated connection without it, it is auth", and the username isn't needed to authenticate.
2. **Repeated scrobbles in `recent`.**
   - **Recommendation:** each song once, at its most recent scrobble, identified by lower-cased artist and title. A playlist of "what I listened to" rarely wants a song twenty times, and every output would write the repeats once anyway (#114, spec-spotify-output.md).
   - Alternative: keep every scrobble, as v1 did.
3. **Enriching albums and lengths.** Loved tracks carry neither, top tracks carry length only, and the matcher weighs length (#132, P1).
   - **Recommendation:** no enrichment in Phase 2. Title and artist are what Last.fm users scrobble, and the outputs search on them. A `track.getInfo` per song is a request per song against a limit Last.fm doesn't publish, and its pacing would make a 1,000-song loved read take over four minutes.
   - Alternative: enrich songs missing a length or album through `track.getInfo`, paced as above.
4. **⚑ multi-tenancy: the hosted tier and Last.fm's terms.** Last.fm's API terms (§3.1) allow use "solely for non-commercial purposes", and commercial use needs an agreement (partners@last.fm). They require "powered by AudioScrobbler" attribution (§2.7, §4.2.2). ADR-0002 §2 lists Last.fm among the hosted launch services.
   - **Recommendation:** self-host is unaffected, since each self-hoster uses their own key for their own listening. For the hosted tier, file a triage issue like #135 for Cal to read the terms and decide whether to seek an agreement. In this spec, the plugin's `description` carries the attribution ("Reads your listening history from Last.fm. Powered by AudioScrobbler.") so the UI shows it wherever the plugin appears.
   - Alternative: no attribution until a hosted tier exists. The terms don't distinguish, so this isn't recommended.

## Testing Decisions

- Through the `inputs` handler, `test()` and `runConformance`, against a fake Last.fm API on `Bun.serve` (#114, #136). Fixtures follow the method pages' documented shapes, and `/verify` checks them against the live API with Cal's key, scrubbed of the key and the username.
- **Conformance:** settings fixtures (valid: each variant, a blank `limit`; invalid: `limit` 0 and 1,001, an unknown `period`, a blank `username`); credentials `{ apiKey }`. Strict song-dict validation passes. The auth fields render (the `secret` field included).
- **Cases:** each method called with the right parameters; `recent` window computed from an injected clock; paging stops at `limit` and at `totalPages`; now-playing skipped; repeats dropped keeping the latest; mapping of every field, `"0"` duration absent, no `id`; error 6 throws with the username; 10 throws with a re-enter message; 29 and 429 waited out and retried within bounds, then throws; requests at most one per 250 ms with an injected sleep; no log line or error contains the key; `test()` ok, `invalid-credentials`, `unreachable`, `misconfigured`.
- **The import mapping** against its v1 fixture.

## Out of Scope

- Scrobbling, and anything else that needs a session key and the shared secret.
- Weekly charts (`user.getWeeklyTrackChart`). v1 didn't have them.
- Similar tracks (`track.getSimilar`). spec-spotify-mixer.md mentions it as a possible Phase 3 idea.
- A hosted `Proxy` key (Phase 5).

## Further Notes

- **No change to the `AuthProvider` surface.** One addition to the SDK's `services` list, which the list's own comment anticipates.
- **Sources** (read 16 November 2026): [API introduction](https://www.last.fm/api/intro) (no authentication for reads, identifiable User-Agent, suspension warning); [user.getLovedTracks](https://www.last.fm/api/show/user.getLovedTracks), [user.getRecentTracks](https://www.last.fm/api/show/user.getRecentTracks) (limit maximum 200), [user.getTopTracks](https://www.last.fm/api/show/user.getTopTracks); [API terms of service](https://www.last.fm/api/tos) (§2.7, §3.1, §4.2.2, §4.3.4, §4.4). Key creation at `last.fm/api/account/create` sits behind a login and nothing reports it closed; `/verify` confirms by creating Cal's key.

## Planned tickets and acceptance criteria

**Ticket 1: "Last.fm input"**, blocked by nothing open.

- [ ] `lastfm` is registered with `inputs` only, in `songs` mode, and passes `runConformance`.
- [ ] `lastfm` is in the SDK's `services`; the grant is a `token` flow with one secret `apiKey` field; `LocalAuthProvider` stores and resolves it unchanged.
- [ ] `loved`, `top` and `recent` read the right method with the right parameters, up to `limit`, page by page.
- [ ] A blank `limit` takes 50; 0 and 1,001 are issues.
- [ ] Now-playing is skipped; repeats are handled as open question 2 settles.
- [ ] Songs carry title, artist, and album and length where Last.fm gives them, and no `id`.
- [ ] Errors 6, 10/26, 29/429 and temporary codes behave as specified; requests are paced at most one per 250 ms.
- [ ] `test()` validates the key without a username.
- [ ] No log line, error or logged URL contains the key.
- [ ] `bun run test` and `bun run check` are green for the new package and the SDK.

**Ticket 2: "Last.fm v1 import mapping"**, blocked by ticket 1 and the importer's base ticket.

- [ ] The mapping covers every v1 setting as tabled, tested against a v1 fixture (ADR-0017 §5), and the report asks for an API key.
