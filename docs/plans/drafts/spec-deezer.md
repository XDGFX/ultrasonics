# Spec: Deezer

Draft for grilling. Phase 2 (plugin parity). Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md).

**Verdict: Deezer is not viable as v1 built it.** Deezer has stopped registering new developer apps, and every authenticated call needs one. A self-hoster can't get an app, the hosted tier can't either without a commercial agreement, and v1's tokens belonged to the dead proxy's app. What still works is reading **public** playlists with no token at all. This draft recommends shipping that as a small input, and dropping Deezer's output and private-playlist input from the parity gate until Deezer reopens.

The Deezer facts below were checked on 16 November 2026, partly against Deezer's own pages and partly by calling the live API. Deezer hasn't announced the closure; the evidence for it is listed under Further Notes, with secondary sources marked.

## Problem Statement

v1's `deezer` plugin read a user's own playlists (`/user/me/playlists`) and wrote to them, through an OAuth token that ultrasonics-api obtained with Cal's Deezer app (ADR-0005; #61). That proxy died in November 2022.

v2's answer for every other service is BYO: the self-hoster registers their own app (ADR-0005, ADR-0013 §7). For Deezer that answer is gone:

- `developers.deezer.com/myapps` and every API documentation page now redirect to a login page with "You have to login to accept the terms and conditions of the simple API". The Wayback Machine has those pages redirecting since at least October 2024.
- Users on Deezer's community forum quote the app page as saying "We're not accepting new application creation at this time. Please check again later." Forum Superusers (whose relationship to Deezer the forum doesn't show) said in June 2026 that creation is "suspended … indefinitely due to repeated Terms of Service violations and security abuses", with "no information on when they'll reopen registration … or if they'll reopen it at all".
- Deezer's developer FAQ (updated 9 November 2026) says whitelisting is "not possible, unless there is a commercial agreement", multiple redirect URIs are "not planned for security reasons", and OAuth2 improvements are "not planned".

The OAuth endpoints still answer (`connect.deezer.com/oauth/auth.php` returns 200; `access_token.php` returns "wrong code" for a dummy code), so a self-hoster who still holds an app made before the closure could connect. Nobody else can.

What works without any app, checked live:

- `GET https://api.deezer.com/playlist/<id>/tracks` for a public playlist, paged by `index` and `limit` with a `next` URL. `limit=2000` returned all 1,021 tracks of one playlist.
- `GET /track/isrc:<ISRC>`.
- `GET /search?q=radiohead creep` (plain text). The field syntax v1 used (`track:"…" artist:"…"`) returned no results at all on 16 November 2026.

## Solution

Two parts, the second of which is a recommendation rather than work:

1. **A small `deezer` plugin with an `inputs` component that reads public playlists by link**, with no auth. It needs no app, no grant and no service-registry entry, and it works the same on self-host and on the hosted tier.
2. **Deezer's output and its private-playlist input leave Phase 2's parity gate**, recorded in the roadmap's "Dropped" list with the date and the reason, to be revisited if Deezer reopens app registration. The `oauth2` flow with a client secret, which they would need, is not built (#136 decision 2 deferred it "until a plugin needs one").

## User Stories

1. As a user, I want to paste the link to a public Deezer playlist and have its songs read, with no Deezer account connected, so that Deezer → Spotify or Deezer → Plex works without a developer app.
2. As a user, I want several playlists read in the order I gave them.
3. As a user, I want each song to carry its title, artist, album, ISRC, length, explicit flag and Deezer id, so that the matcher has its strongest keys (ADR-0023).
4. As a user, I want a 1,000-song playlist read in full.
5. As a user, I want a private or deleted playlist skipped with a warning naming it, while the others read.
6. As a user, I want the settings form to say only public playlists can be read, and why.
7. As a user, I want Deezer's quota errors to slow the run, not fail it, within a bound.
8. As a v1 Deezer user, I want the import report to say which applets couldn't come across and why, so that I can rebuild the ones the public input can serve.
9. As Cal, I want the drop recorded with its evidence, so that it is revisited when Deezer changes its mind, not re-argued per port.
10. As a maintainer, I want the plugin tested offline against a fake Deezer API.

## Implementation Decisions

### Package and handshake

- `packages/plugins/deezer/` (ADR-0014 §6), depending on `@ultrasonics/plugin-sdk` only. HTTP through `fetch`. `createDeezerPlugin({ apiBase })` is the test seam, as `createSpotifyPlugin` is (#136).
- `name: "deezer"`, `mode: ["playlists"]`, `inputs` only. **No `auth`.** A plugin without an `AuthSpec` is already legal (`auth?` in `PluginDefinition`). No `persistentSettings`.
- `services` in the SDK is **not** extended, because nothing declares a Deezer grant. ADR-0002's per-service kill-switch can still name the plugin.

### Instance settings (`inputs`)

A flat object inside ADR-0019 §3's subset:

- `playlists`: a non-empty string of Deezer playlist links or ids, comma-separated. A `.refine()` accepts `https://www.deezer.com/<locale>/playlist/<id>` (with or without a locale or query string) and a bare numeric id. Short links (`link.deezer.com/s/…`) are refused with an issue telling the user to open the link and copy the full address, because resolving them means following a redirect at save time. Same pattern as the Spotify input's `chosen` (#136 decision 8).
- Its `description` says only public playlists can be read, because Deezer no longer registers the apps that private playlists need.

### Reading (`run.inputs`)

- For each id in order, duplicates once: `GET /playlist/<id>` for its title and description, then page `GET /playlist/<id>/tracks?limit=<page>&index=<n>` by `next`. Page size is open question 3.
- Deezer reports errors inside a 200 body as `{ "error": { "type", "message", "code" } }`. The client reads every body for it:
  - code `4` ("Quota limit exceeded"): wait five seconds and retry that request, at most three times and 60 seconds in total per run, logging each wait at `info`. Past that it throws. Deezer publishes no rate; this is the same shape as Spotify's bound (#136 decision 7).
  - code `800` (`DataException`, "no data") or an `OAuthException` on a playlist: skip that playlist with a `warn` naming it. A missing playlist answers 800 (checked live); what a private one answers without a token couldn't be checked, so both are treated alike.
  - Anything else, a non-200 status, or a network error: throw.
  - Every request has a 30-second timeout.
- **Mapping a track to a `Song`:**
  - `title`: `title`, trimmed. Blank: skipped.
  - `artists`: `[artist.name]`. The tracks list gives the main artist only; v1 fetched `/track/<id>` per song for `contributors`, which costs a request per song against an unpublished quota (open question 2).
  - `album`: `album.title`.
  - `durationMs`: `duration × 1000` (Deezer gives seconds).
  - `explicit`: `explicit_lyrics`.
  - `isrc`: `normaliseIsrc(isrc)`. The tracks list carries it (checked live).
  - `date`: not in the tracks list. Open question 2.
  - `id`: `{ deezer: String(id) }`.
  - `readable: false` tracks (unavailable in the requester's country) are still carried; the song exists, Deezer just won't play it here.
- **Mapping a playlist:** `name` from `title`, `description` when non-blank, `id: { deezer: String(id) }`.
- One summary `warn` per playlist for skipped tracks, as the Spotify input does.

### No `test()`

There is nothing to test without credentials. ADR-0012 §5 makes `test()` optional.

### What is not built, and why ⚑ checkpoint: auth layer

The output and the private-playlist input would need:

- an `oauth2` flow with a client secret (Deezer has no PKCE; `access_token.php` takes `app_id`, `secret` and `code`), which `LocalAuthProvider` doesn't implement (`pkceOnly`) and #136 decision 2 deferred;
- a per-service client form for a numeric app id and a secret, where `OperatorClient` today is Spotify's 32-hex id;
- the secret held encrypted in operator `instance_settings` (#109), a storage change.

Each is an auth-layer change, and none can be tested without a Deezer app. This spec recommends not making them now (open question 1).

### v1 import mapping (ADR-0017 §4–5)

A module `deezer` in the importer. No v1 Deezer setting carries across:

| v1 `deezer` | v2 |
|---|---|
| `auth` | Not imported (ADR-0017, Context: issued to the proxy's app). |
| `fuzzy_ratio`, `created_playlists` | Dropped with the output. |
| input `filter` | Can't become playlist links: v1 read `/user/me/playlists`, which needs a token, and stored no list. |
| output `existing_playlists` | Dropped with the output. |

So **every v1 applet that uses `deezer` is skipped and reported**, with its v1 config and one of two reasons: "Deezer no longer registers developer apps, so ultrasonics can't write to Deezer" for an output, and "ultrasonics can now read only public Deezer playlists, by link; rebuild this applet with the links you want" for an input. This is ADR-0017 §4's unknown-plugin outcome with a specific message. The mapping is tested against a v1 fixture with one Deezer input applet and one Deezer output applet.

### v1 behaviour dropped

- The quota retry checked `r.status_code == 4`, an HTTP status that can't occur. Deezer sends code 4 inside a 200 body, so v1 never retried.
- The field search syntax (`track:"…" album:"…"`), which no longer returns results.
- `new_ids = list(set(new_ids))` in the output, which shuffled the order of every write, and the stale `existing_tracks` across playlists that the Spotify output shared (spec-spotify-output.md).
- A per-track `/track/<id>` request for every song read.

## Open questions

1. **Drop Deezer's output and private input, or build them for holders of an old app?** ⚑ auth layer.
   - **Recommendation:** drop them from Phase 2, recorded in the roadmap's "Dropped" list with this evidence and a note to revisit if Deezer reopens registration. Ship the public input. Nobody new can register an app, the code would be untestable without one, and it would bring an `oauth2`-with-secret flow and encrypted operator secrets into the auth layer for a cohort nobody can count.
   - Alternative A: build the `oauth2` flow and the output for self-hosters who still hold a pre-closure app, with the secret encrypted in `instance_settings`. Worth it only if Cal still holds the app ultrasonics-api used and wants to test against it, and even then that app can't be shared with self-hosters (ADR-0005).
   - Alternative B: drop Deezer entirely, input included. The public input is about 200 lines and serves a real case (Deezer → anything), so dropping it gives up working behaviour for little.
2. **Per-track enrichment.** The playlist tracks list carries the ISRC, but no release date and only the main artist. `GET /track/<id>` has both, one request per song, against a quota Deezer doesn't publish; about 80 parallel requests tripped it.
   - **Recommendation:** no enrichment. The matcher decides on ISRC, title, artist and length (#132, P1), all of which the list has. Date only breaks ties in `bestMatch`, and a missing featured artist costs little against a shared ISRC.
   - Alternative: enrich sequentially, as v1 did, for the date and the full artist list. A 1,000-song playlist becomes 1,000 extra requests.
3. **Page size.** Deezer's default is 25; `limit=2000` worked in one test.
   - **Recommendation:** 100, v1's figure. Large pages work today but nothing documents a maximum, and 100 keeps a 1,000-song playlist to ten requests.
   - Alternative: 1,000, fewer requests, more exposure to an undocumented cap.
4. **The hosted tier.** ADR-0002 §2 lists Deezer among the hosted launch services, and ADR-0002's kill-switch assumes an app exists to switch off.
   - **Recommendation:** file a triage issue for Cal like #135, "Revisit ADR-0002's Deezer plan for the hosted tier", covering the public input (which works hosted) and whether a commercial agreement is worth pursuing. Not decided here.

## Testing Decisions

- Through the `inputs` handler and `runConformance`, against a fake Deezer API on `Bun.serve` (#114, #136). Fixtures are written from live responses recorded on 16 November 2026 for a public playlist, a track and an ISRC lookup, trimmed and free of personal data.
- **Conformance:** settings fixtures (valid: one link, several, a bare id; invalid: blank, a short link, a Spotify link). Strict song-dict validation passes.
- **Cases:** links and ids parsed, order kept, duplicates read once; paging by `next` reads every page in order; every mapped field, blanks absent, seconds turned into milliseconds; no request to `/track/<id>` unless open question 2 settles on enrichment; a private playlist (`OAuthException`) and a missing one (code 800) skipped with a warning while the rest read; code 4 waited out and retried within bounds, then throws; a non-200 throws; the tests inject the sleep.
- **The import mapping** against its v1 fixture.

## Out of Scope

- Deezer's output and private playlists (open question 1).
- Reading a user's favourites or "flow". Both need a token.
- Searching Deezer. Nothing in the input searches.
- Short links.

## Further Notes

- **No change to the plugin SDK contract or the auth layer** under the recommendation. Alternative A in open question 1 would make both.
- **The roadmap edit** (Phase 2's list and "Dropped") and the parity matrix belong to this spec's ticket, as spec-spotify-mixer.md's do.
- **Evidence, checked 16 November 2026:**
  - Deezer, primary: [Deezer FAQs for developers](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers) (updated 9 November 2026); `developers.deezer.com/myapps` and the API documentation pages redirecting to login (live).
  - Deezer, live API calls: OAuth endpoints answering; `/user/me` without a token returning `OAuthException`; public playlist tracks, `/track/isrc:…` and plain-text search working without a token; field-syntax search returning `{"data":[],"total":0}` (from Australia); "Quota limit exceeded", code 4, after about 80 parallel requests.
  - Secondary, Deezer community forum: [June 2026 thread quoting the app page and the "suspended indefinitely" reply](https://en.deezercommunity.com/other-devices-49/impossible-de-creer-une-app-migration-spotify-vers-deezer-pour-un-projet-de-decouvert-et-jeux-musicaux-82752); [20 June 2026 thread](https://en.deezercommunity.com/other-devices-49/create-developer-app-82800).
  - Not found in any public primary source, because the documentation sits behind the login: permission names, token lifetime, redirect URI rules, write endpoint limits, and any deprecation notice for the REST API.

## Planned tickets and acceptance criteria

**Ticket 1: "Deezer public-playlist input"**, blocked by nothing open.

- [ ] `deezer` is registered with `inputs` only and no auth, and passes `runConformance`.
- [ ] Links and bare ids parse; a short link or a non-Deezer link is an issue on `playlists`.
- [ ] A public playlist is read in full, in order, page by page, with title, artist, album, ISRC, length, explicit and id mapped, and date and full artists only if open question 2 settles on enrichment.
- [ ] A private or missing playlist is skipped with a warning; the others read.
- [ ] Code 4 is retried within its bounds, then throws.
- [ ] `roadmap.md` and the parity matrix record Deezer's output and private input as dropped, with the date, the evidence and the revisit condition.
- [ ] `bun run test` and `bun run check` are green for the new package.

**Ticket 2: "Deezer v1 import mapping"**, blocked by the importer's base ticket.

- [ ] Every v1 applet using `deezer` is skipped and reported with its config and the matching reason; tested against a v1 fixture (ADR-0017 §5).
