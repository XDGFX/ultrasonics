# Spec: the Spotify output

Draft for grilling. Phase 2 (plugin parity). Builds on [Spec: the Spotify input plugin and the PKCE provider](https://github.com/XDGFX/ultrasonics/issues/136), whose plugin, client and grant this spec extends, and mirrors [Spec: the Plex output plugin](https://github.com/XDGFX/ultrasonics/issues/114) wherever Spotify allows. Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md).

Spotify facts were read from Spotify's developer documentation on 16 November 2026. Sources are at the end.

## Problem Statement

Plex → Spotify, local files → Spotify and Spotify → Spotify all need a Spotify output. v2 has only the input.

v1's Spotify output failed in ways the backlog recorded:

- A title with `:`, quotes or curly quotes (`“Heroes”`, `Let’s Dance`) produced a 400 from search, and v1 read the 400 as an expired token, which killed the run (#56, must-still-work #2 and #6).
- Mainstream tracks (Bowie, Queen) went unmatched (#56).
- Every failure aborted the whole run (#29, #38).

It also had faults nobody filed:

- `existing_tracks` was set inside the playlist loop and tested with `"existing_tracks" not in vars()`, so every playlist after the first compared against the **first** playlist's tracks. In `Update` mode it removed tracks by that wrong list.
- A song already in the playlist was recorded as a duplicate and then added again, so `Append` piled up repeats.

Spotify's own rules have moved since v1 (#136, Problem Statement): development mode, five users, Premium on the owner's account, playlist items readable only from playlists the user owns or collaborates on, and search capped at 10 results.

## Solution

Add an `outputs` component to the existing `spotify` plugin. For each playlist it receives, it:

1. finds the target playlist among the user's own and collaborative playlists, by Spotify id, then by name;
2. finds each song on Spotify: by its own Spotify id, else by search, with the shared matcher choosing among the results;
3. creates the playlist, or appends to or updates the existing one;
4. returns an `OutputResult` naming every playlist exactly once (ADR-0020).

Writing needs two more scopes, so every existing Spotify grant must reconnect once (⚑, decision in #136 grilling 5, and open question 1 here).

## User Stories

**Connecting**

1. As a user already connected for the input, I want to be told to reconnect once when the output arrives, with a clear reason, so that I grant the write access it needs (#136 decision 5).
2. As a user, I want the consent page to ask for read and modify access to my playlists and nothing more.

**Choosing how to write (instance settings, `outputs`)**

3. As a user, I want playlists the output creates to be private unless I choose public.
4. As a user, I want an existing playlist appended to by default, so that a sync never removes tracks I added by hand.
5. As a user, I want to choose "update", with a warning that tracks not in the source will be removed, so that the Spotify playlist mirrors the source.

**Finding the target playlist**

6. As a user syncing Spotify → Spotify, I want a playlist that carries a Spotify id written back to that playlist, if I own it or collaborate on it.
7. As a user, I want a playlist without a usable Spotify id matched by name among my own and collaborative playlists, so that a second sync writes to the playlist the first one created.
8. As a user with two of my playlists sharing a name, I want that playlist skipped with a reason, so that the output never guesses which one to overwrite.
9. As a user, I want a playlist I only follow never written to, because Spotify would refuse.

**Matching**

10. As a user, I want a song that already carries a Spotify id written straight to that track with no search.
11. As a user, I want a song with an ISRC found by ISRC first, because it is the strongest key.
12. As a user, I want titles with colons, quotes, curly quotes and non-ASCII characters to search correctly, so that `“Heroes”` and `Let’s Dance` match (must-still-work #6, #7; #56).
13. As a user, I want a search Spotify rejected counted as unmatched for that song, never treated as an expired token (#56).
14. As a user, I want the same matcher that the Plex output uses to choose the track, so that matching behaves the same on both.

**Writing**

15. As a user, I want a missing playlist created with the source's name and description.
16. As a user, I want appending to skip tracks the playlist already holds.
17. As a user choosing "update", I want the playlist to end up holding exactly the matched tracks in source order.
18. As a user choosing "update", I want a failed write never to leave my playlist empty.
19. As a user with a 3,000-song playlist, I want it written in full.
20. As a user, I want a playlist where nothing matched skipped with a warning, and an empty playlist skipped too (must-still-work #1).
21. As a user, I want a playlist Spotify refused reported as failed while the rest sync (must-still-work #2, #8).
22. As a user, I want a rate limit to slow the run, not fail it, within a bound.
23. As a user, I want to see per playlist how many songs matched of how many were supplied, and which didn't (ADR-0020).
24. As a user, I want my tokens kept out of every log line and stored error.

**Migrating**

25. As a v1 user, I want my Spotify applets, input and output, imported with their settings, and told to reconnect Spotify (ADR-0017).

**Maintainers**

26. As a maintainer, I want the output tested offline against a fake Web API, including search's quirks.
27. As a maintainer, I want the plugin to pass `runConformance` with both components.

## Implementation Decisions

### Handshake and auth ⚑ checkpoint: auth layer

- `spotify` gains `outputs` (ADR-0012 §1–2). `components` becomes `["inputs", "outputs"]`. Description: "Reads and writes playlists on your Spotify account".
- `scopes` becomes `playlist-read-private`, `playlist-read-collaborative`, `user-library-read`, `playlist-modify-private`, `playlist-modify-public`.
- **Every grant made before this lands resolves to `reconnect`**, because `checkGrant` finds a stored `scope` narrower than the declared one (`pkce-flow.ts`). That is #136 decision 5 working as designed. No v2 user exists before Phase 4's release, so the cost is Cal's own test grant. The `reconnect` message names the reason ("ultrasonics now needs permission to change your playlists").
- The scopes apply to the whole plugin, input applets included. One plugin has one `defineAuth` (ADR-0013 §2), and two plugins sharing a service must declare it identically or the server refuses to boot (`catalogue.ts`). Splitting read and write grants would need two services, which ADR-0013 §2 rules out for one Spotify account.

### Instance settings (`outputs`)

A flat object inside ADR-0019 §3's subset:

- `existing`: `append` or `update`, default `append`. `update` carries `warning` metadata: tracks in the Spotify playlist that aren't in the source are removed. Same names as the Plex output (#114), so the importer maps both the same way.
- `visibility`: `private` or `public`, default `private`. Applies only to playlists the output creates. Open question 2 covers where it lives.

No match threshold (#104, decision 7). That removes v1's `fuzzy_ratio` and the crash a blank one caused elsewhere (#47).

### The client

`SpotifyClient` reads only (`get`, `all`). It gains `post`, `put` and `delete` with JSON bodies, sharing the input's timeout (30 seconds), its `429` handling and its token hygiene. The `429` bound is open question 4.

### Run, per output call

1. `GET /me` once, for the user's id.
2. Page `GET /me/playlists?limit=50`. Keep playlists the user owns or collaborates on, as the input's `all` does. Index them by id and by name.
3. For each playlist, in order, inside its own error boundary (ADR-0020 §3):
   - **Empty in:** `skipped`, code `empty`.
   - **Target:** the source's `id.spotify` if it is in the index; else the playlists whose name equals the source's, trimmed, compared exactly (open question 5). Two or more: `skipped`, code `ambiguous-playlist`, with a `warn`. None: create.
   - **Match** each song (below). Nothing matched: `skipped`, code `no-matches`, with a `warn`, and nothing is created.
   - **Write** (below). A `403`, `404`, other `4xx` or `5xx` on any write request for this playlist: `failed`, code `service-error`, with the status. The output moves on.
   - Otherwise `written`, with `unmatched` as the positions of songs that didn't reach the playlist.
   - `401` throws: the token was refused despite `resolve()` (ADR-0013 §5).
4. Return the `OutputResult` (ADR-0020 §2).

### Matching a song

- **Own ID space:** a song with `id.spotify` that is a 22-character base-62 id is used as `spotify:track:<id>` with no search, as v1 did. Spotify's batch track lookup is gone in development mode (#136, Further Notes), so the id isn't checked first. An id Spotify no longer knows makes the add request fail; open question 6 covers that.
- **ISRC:** `GET /search?type=track&limit=10&q=isrc:<ISRC>`.
- **Fields:** if ISRC is absent or found nothing, one query `track:<title> artist:<first artist>`, then, if that found nothing, `track:<title cut before its first bracket, dash or colon>` with the same artist. Each value has `"` and `“”` stripped, `’` folded to `'`, and is URL-encoded as a whole, so a colon never reaches Spotify as a field separator inside a value. Identical queries are skipped. This is the shared cleaning `legacy-architecture.md` asks for, kept in one module in this package.
- **Choosing:** the candidates, mapped to `Song` through the input's mapping, go to `bestMatch` from `@ultrasonics/matcher`, which returns the match or none. No threshold or tie-break of the plugin's own.
- **Search failure:** a `400` or `5xx` on one search makes that song unmatched, with a `debug` line, never a reconnect (#56). `401` throws.
- **Repeats:** a song whose track an earlier song in the same playlist already matched isn't written, is listed in `unmatched`, and gets a `warn`. Spotify allows repeats, but writing each track once keeps "update" from the same source identical on Spotify and Plex (#114).

### Writing a playlist

- **Missing:** `POST /me/playlists` with the source's `name`, `public` from `visibility`, and the source's `description` when it has one. The old `POST /users/{id}/playlists` is removed. Then add the matched tracks in source order.
- **Existing, `append`:** page `GET /playlists/{id}/items` (at most 50 a page), then `POST /playlists/{id}/items` with the matched tracks it doesn't already hold, in source order, at the end.
- **Existing, `update`:** `PUT /playlists/{id}/items` with the first 100 matched tracks, which replaces the playlist's items in one request, then `POST` the rest in order. A failure on the first request leaves the playlist as it was; a failure later leaves it holding a prefix of the target, never empty. Open question 3 covers the alternative.
- `POST` and `PUT` carry at most 100 URIs each, Spotify's limit. Nothing uses `DELETE /playlists/{id}/items`, since the replace covers removal.
- The description is set only on create, so a description the user edited on Spotify survives.

### `test()`

Unchanged from #136.

### v1 import mapping (ADR-0017 §5)

One module, `spotify`, for both components, because v1 had one plugin.

| v1 `spotify` | v2 `spotify` |
|---|---|
| `auth` (refresh token) | Not imported. Reported as "reconnect Spotify" (ADR-0017 §3). |
| `fuzzy_ratio` | Dropped (#104 decision 7). |
| `created_playlists` `Public`/`Private` | `visibility` `public`/`private` on each imported output applet. Missing or blank: `private`. |
| input `mode: playlists`, `filter` blank | `{ source: "all" }` |
| input `mode: playlists`, `filter` non-blank | As spec-plex-input.md open question 1 decides: recommended, skip and report. |
| input `mode: saved`, `playlist_title` | `{ source: "liked", name: playlist_title }`, or v1's default `"Spotify Saved Songs"` when blank. |
| output `existing_playlists` `Append`/`Update` | `existing` `append`/`update` |
| `config/up_spotify/*` files | Not read (ADR-0017 §2–3). |

**A correction to ADR-0017 §5.** It names "Spotify's and Deezer's `created_playlists`" as state a mapping must carry "otherwise the first v2 run could create duplicate playlists". In v1's source both are a `Public`/`Private` radio, a preference, not a record of created playlists. v1 found existing playlists by id or name each run (`up_spotify.py`, `up_deezer.py`). The mapping above carries it as a preference. The ADR's sentence should be amended when this lands; nothing in the decision changes.

**A behaviour change worth a release note.** v1's saved mode emitted only songs saved since the last run, tracked in a per-applet SQLite file, and raised an exception when there were none. v2 reads all liked songs every run (#136, Out of Scope). With `append` the result is the same. With `update`, v1 replaced the playlist with only the new songs each run; v2 mirrors the full list.

### v1 behaviour dropped

- The stale `existing_tracks` across playlists, and re-adding duplicates in `Append`.
- Fuzzy-matching the source against the playlist's existing tracks before searching. v2 matches every song to a Spotify track first and compares track ids, which is exact.
- The fixed description "Created automatically by ultrasonics with 💖".
- Reading a 400 as an expired token (#56).

## Open questions

1. **⚑ Scopes: both modify scopes?** `playlist-modify-public` and `playlist-modify-private` are separate. A playlist's visibility decides which one a write needs.
   - **Recommendation:** both. A user's existing public playlists are common targets, and the reconnect happens once either way.
   - Alternative: `playlist-modify-private` only, with `visibility` removed and every write limited to private playlists. Writes to an existing public playlist would fail with `403`.
2. **Where does `visibility` live?** v1 kept it account-wide.
   - **Recommendation:** an instance setting on the output, as above. It sits beside `existing`, where the user decides what a sync does, and the importer copies the v1 value onto each output applet.
   - Alternative: `persistentSettings`, which puts Spotify on the plugin settings page (ADR-0019 §6) for one field.
3. **`update` on a long playlist.** Replace-then-add can leave a prefix if a later request fails.
   - **Recommendation:** accept it. The playlist is never empty, the run reports `failed` for it, and the next run completes it.
   - Alternative: Plex's add-first approach (#114): add what's missing, remove the extras, then reorder with one move request per misplaced track. It never loses a track, but it costs up to one request per song, against development mode's unpublished rate limit.
4. **The `429` budget.** The input waits at most 120 seconds per run (#136 decision 7). An output searches up to three times per song: a 2,000-song first sync is up to 6,000 requests.
   - **Recommendation:** the same per-request rule (three retries) and a larger per-run wait budget for the output, 15 minutes, logged at `info`. Past it, the current playlist is `failed` with code `rate-limited` and the output throws, because every later playlist would hit the same wall.
   - Alternative: keep 120 seconds and let large first syncs fail; the next run picks up where `append` left off.
5. **Name lookup.** Spotify names are case-sensitive and users rename freely.
   - **Recommendation:** exact after trimming, owned or collaborative only. The id lookup handles Spotify → Spotify; names handle everything else.
   - Alternative: case-insensitive, which merges "Gym" and "gym" when both exist (they become `ambiguous-playlist`).
6. **A stale `id.spotify`.** A track Spotify removed makes the whole batch of 100 fail with a 400.
   - **Recommendation:** on a 400 from an add, retry that batch one track at a time, list each refused track as unmatched with a `warn`, and keep the playlist `written`. The cost only lands when a batch fails.
   - Alternative: look each id up with `GET /tracks/<id>` before adding, one request per song on every run.

## Testing Decisions

- Through the plugin's handlers, `test()` and `runConformance`. Assertions on the `OutputResult`, log lines, and the requests the fake Web API received (#114, #136).
- **The fake** is the input's `Bun.serve` fake, extended with `/search`, playlist create, and items `POST`/`PUT`/`DELETE`. Search answers from a small catalogue by `isrc:`, `track:` and `artist:` filters, and returns a 400 for a query containing an unbalanced quote, which is the failure #56 recorded. Fixtures are written from Spotify's documented shapes and checked against Cal's development-mode app during `/verify`.
- **Conformance:** `outputs` settings fixtures (valid: defaults, `update`, `public`; invalid: unknown `existing`), the SDK's default song dict. All invariants pass, including output completeness.
- **Cases:**
  - Target: by id; by name; a followed playlist is never a target; two owned playlists with one name → `ambiguous-playlist`.
  - Writes: create with visibility and description; `append` skips present tracks; `update` with 250 tracks makes one `PUT` and two `POST`s in order; a failure on the second `POST` leaves a prefix and the playlist `failed`.
  - Matching: own id → no search; ISRC first; the title/artist fallback; `“Heroes”`, `Let’s Dance` and a title with a colon reach the fake intact and match; a search 400 → that song unmatched, the playlist still written; repeats listed in `unmatched` with a warning.
  - Results: empty → `skipped` `empty`; no matches → `skipped` `no-matches` with no create request; a 500 on one playlist's write → `failed` while the next is `written`.
  - Errors: 401 throws; `429` retried within its bounds, then as open question 4 decides; no URL, body, log line or error contains a token.
- **Provider:** a grant whose stored scope lacks the modify scopes resolves to `reconnect` (already covered in `pkce-flow.test.ts`; one case added naming the output's scopes).
- **The import mapping** against a v1 fixture holding a playlists-mode input with a blank filter, one with a filter, a saved-mode input, and an output with each `existing_playlists` value and each `created_playlists` value.

## Out of Scope

- Writing Liked Songs (`PUT /me/tracks`). v1 never did.
- Playlist cover art (#52), folders (PR #45 request).
- spotify-mixer (spec-spotify-mixer.md recommends dropping it).
- The hosted tier's Spotify plan (#135).
- Collaborative-playlist creation.

## Further Notes

- **No change to the plugin SDK contract.** The scope change is data in `defineAuth`, which #136 decision 5 already planned for. If the build finds it needs an SDK change, it stops and asks.
- **Development mode limits writes the same way it limits reads:** an app allows five users, each allowlisted, and the owner needs Premium (#136).
- **One risk for `/verify` to settle first.** Spotify says new development-mode apps get "a smaller set of supported endpoints" (February 2026). The migration guide lists the playlist write endpoints with no restriction, but no page says outright that a new app may write playlists. The ticket's first step is one create and one add against Cal's app. If they're refused, the build stops and this spec comes back to Cal.
- **Quota.** Since 23 July 2026 a developer account may hold 25 client ids, sharing one quota; a quota `429` carries `"reason": "QUOTA_EXCEEDED"`. The client treats it as any `429`.
- `external_ids` (the ISRC) was removed in February 2026 and restored in March, so candidates carry ISRCs again.
- **Sources** (read 16 November 2026):
  - [Scopes](https://developer.spotify.com/documentation/web-api/concepts/scopes)
  - [Create Playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist), [Add Items to Playlist](https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist), [Update Playlist Items](https://developer.spotify.com/documentation/web-api/reference/reorder-or-replace-playlists-items)
  - [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [Update on developer access](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security), [March 2026 changes](https://developer.spotify.com/documentation/web-api/references/changes/march-2026), [Web API quota updates](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates)
  - [Search for Item](https://developer.spotify.com/documentation/web-api/reference/search)
  - [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)

## Planned tickets and acceptance criteria

**Ticket 1: "Spotify output"**, blocked by nothing open (#136 is delivered).

- [ ] Before anything else, one create and one add succeed against Cal's development-mode app; if not, the build stops and asks.
- [ ] `spotify` has `inputs` and `outputs`; `runConformance` passes for both.
- [ ] The declared scopes include both modify scopes, and a grant without them resolves to `reconnect` with a message saying why.
- [ ] Targets resolve by id, then by exact name among owned and collaborative playlists; ambiguous names are skipped; followed playlists are never written.
- [ ] Create, `append` and `update` behave as specified, in batches of 100, in source order, each track once.
- [ ] `update` never leaves a playlist empty.
- [ ] `“Heroes”`, `Let’s Dance` and a title with a colon match against the fake; a search 400 makes only that song unmatched (#56).
- [ ] Every playlist appears once in the `OutputResult`; empty, no-match and ambiguous playlists are `skipped` with the specified codes; a refused write is `failed` and the next playlist still writes.
- [ ] `429`s are handled within the bounds open question 4 settles.
- [ ] No request URL, body, log line or error contains a token.
- [ ] `bun run test` and `bun run check` are green for `plugin-spotify` and the server.

**Ticket 2: "Spotify v1 import mapping"**, blocked by ticket 1 and the importer's base ticket.

- [ ] The mapping covers both components and the persistent settings as tabled, tested against a v1 fixture (ADR-0017 §5).
- [ ] The report tells the user to reconnect Spotify.
- [ ] ADR-0017 §5's `created_playlists` sentence is amended to describe it as a preference.
