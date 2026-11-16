# Spec: the Plex input

Draft for grilling. Phase 2 (plugin parity). Builds on [Spec: the Plex output plugin](https://github.com/XDGFX/ultrasonics/issues/114), whose package, client and track mapping this spec reuses, and on [Spec: the Spotify input plugin and the PKCE provider](https://github.com/XDGFX/ultrasonics/issues/136), whose settings shape it follows. Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md).

The response shapes below were checked against Cal's Plex test server (PMS 1.43.5) on 16 November 2026, read-only.

## Problem Statement

The Plex output landed in Phase 1. Plex → Spotify, and Plex → anything, still has no input. v1's Plex beta input had two faults users hit:

- It gave each playlist a `title` key instead of `name`, so every output downstream crashed with `KeyError: 'name'` (#59, must-still-work #4). The bug is still on `master`.
- Its regex filter worked, but only because Plex beta filtered before fetching songs (#15, must-still-work #10). The legacy `plex` input fetched everything first.

It also wrote `id: { plex: playlist.key }`, where the key is a path (`/playlists/51/items`) and is unique only on one server, which ADR-0023 §2 rules out.

## Solution

Add an `inputs` component to the existing `plex` plugin, in `playlists` mode. It reads the audio playlists the applet names, or all of them, and maps each item to a `Song` through the output's `toSong`. It skips what can't be a song, with one warning per playlist, and filters by title before it fetches any items.

No new package, no new grant and no new service: the input uses the same `plex` grant as the output (ADR-0013 §2).

## User Stories

1. As a user with Plex connected for the output, I want the input to work with no second connection, so that one grant serves both (ADR-0013 §2).
2. As a user, I want to read every audio playlist on my server, optionally leaving some out by name.
3. As a user, I want to name the playlists to read, compared without regard to case, so that I don't need to know their ids.
4. As a user, I want titles filtered before any songs are fetched, so that a server with 300 playlists doesn't read all of them to sync two (#15).
5. As a user, I want my smart playlists read like any other, so that a Plex smart playlist can feed Spotify.
6. As a user, I want video and photo playlists ignored, so that only music reaches the outputs.
7. As a user, I want each playlist emitted with its Plex title as `name`, its summary as `description`, and its id in this server's ID space, so that every output reads it (#59).
8. As a user, I want each song to carry its title, artist, album, release date, length, file location and Plex id.
9. As a user, I want songs in the order Plex holds them.
10. As a user with a 5,000-track playlist, I want every track read, page by page.
11. As a user, I want an item with no title skipped with a warning while the rest of the playlist reads (must-still-work #2).
12. As a user, I want a chosen playlist that doesn't exist reported in the log by name, while the others read.
13. As a user, I want a refused token or an unreachable server to fail the run with the same messages the output gives.
14. As a user, I want my token kept out of every log line and error.
15. As a v1 user, I want my Plex input applets imported where their filter can be carried across, and reported where it can't (ADR-0017 §5).
16. As a maintainer, I want the input tested offline against the output's fake server and recorded fixtures.

## Implementation Decisions

### Package and handshake

- `packages/plugins/plex/` gains `inputs` in `instanceSettings` and `run` (ADR-0012 §1–2). `components` becomes `["inputs", "outputs"]` by derivation. `mode` stays `["playlists"]`. The description becomes "Reads and writes playlists on a Plex Media Server".
- The `plex` registry entry is unchanged (ADR-0012 §4).
- **No change to the auth spec.** The input uses `ctx.auth.get()` exactly as the output does (ADR-0013 §3). No reconnect for existing grants, because the declared fields don't change.

### Instance settings (`inputs`)

A `z.discriminatedUnion("source", …)` of flat objects inside ADR-0019 §3's subset, following the Spotify input's grilled shape (#136, decisions 3 and 8):

| `source` | Title | Fields |
|---|---|---|
| `all` | "all my playlists" | `exclude`: optional string, playlist titles, comma-separated, compared case-insensitively. |
| `chosen` | "playlists i choose" | `playlists`: non-empty string, playlist titles, comma-separated, compared case-insensitively. |

Plex has no shareable playlist link to paste, so `chosen` uses titles where Spotify uses links. Open question 1 covers a v1-style regex.

### Reading (`run.inputs`)

1. `PlexClient.connect(grant)` gives the machine identifier, as the output does. Unreachable or 401 throws, with the output's messages.
2. `GET /playlists?playlistType=audio` once. The server filters out video and photo playlists itself. Smart and ordinary playlists both stay (open question 2).
3. Filter by title before any items are read (#15):
   - `all`: drop titles in `exclude`.
   - `chosen`: keep titles in `playlists`, in the order the user gave them. A name that matches nothing gets a `warn`. A name that matches several playlists reads each of them, with a `warn` naming the count (open question 3).
4. For each kept playlist, page `GET /playlists/<ratingKey>/items` with `X-Plex-Container-Start` and `X-Plex-Container-Size` (a page size of 200), until `totalSize` is reached or a page comes back empty. The test server confirmed both headers and `totalSize`. The client's existing `playlistItems()` reads unpaged; this spec pages it, which the output's existing-playlist read also gets.
5. Map each item through `toSong(track, machineIdentifier)` from `track.ts`. `undefined` (no title) is skipped. Items whose `type` isn't `track` are skipped. Each playlist gets **one** summary `warn` with counts, as the Spotify input does (#136).
6. Emit `{ name: title, description: summary, id: { "plex:<machine identifier>": ratingKey }, songs }`. A blank summary is left out (ADR-0023 §3).
7. A `404` on one playlist's items (deleted between the list and the read) skips it with a `warn`. `401` throws. Any other `4xx`, `5xx` or network error throws, as the Spotify input decided for its reads (#136). Every request keeps the output's 30-second timeout.
8. One `info` line per playlist: its title, songs read, and how many were skipped.

### The song mapping

`toSong` is shared with the output and doesn't change, apart from one point checked on the test server:

- With `includeGuids=1`, Plex returns a track's `Guid` as `mbid://<uuid>`. Looked up against MusicBrainz, that uuid is a **track** id (one track on one release), not the recording MBID ADR-0023 §2 assigns to `id.musicbrainz`. So the input does **not** set `id.musicbrainz` and doesn't send `includeGuids`. Carrying it under a new ID space (`musicbrainz-track`) would be a song-dict question (ADR-0023 §2), and nothing else emits one yet.
- `location` is the Plex-side file path through `toFileUri`, untranslated (Plex output spec, Out of Scope). An output on another machine will see a path it can't open. That's v1's behaviour without the prepend settings.
- Plex exposes no ISRC (#114).

### `test()`

Unchanged. It already checks the grant against the server's identity.

### v1 import mapping (ADR-0017 §4–5)

A module `plex` in the importer, shared with the output's mapping. Grant and library handling are settled by ADR-0017 §4. For the input component:

| v1 (`plex`/`plex beta` v1.0, `plex`/`plex legacy` v0.1) | v2 `inputs` |
|---|---|
| `filter` blank or absent | `{ source: "all" }` |
| `filter` non-blank | Open question 1. |
| `section_id` on an input | Dropped silently. v1's input never read it. |
| legacy `plex_prepend`, `ultrasonics_prepend` | Dropped, as ADR-0017 §4 says. |

The mapping is tested against a v1 fixture that holds a 1.2.0 `plex` input applet with a blank filter, one with a regex, and a 1.1 `plex beta` applet.

### v1 behaviour dropped

- `title` instead of `name` on playlists (#59).
- `id.plex` holding a path, in a key that collides across servers. v2 uses `plex:<machine identifier>` (ADR-0023 §2).
- `duration` on songs. v2 carries `durationMs` (ADR-0021, Consequences).
- `artists` from `track.artist()`, an extra request per track. v2 reads the item's own `originalTitle` or `grandparentTitle`, as the output already does.

## Open questions

1. **What happens to a v1 regex filter?** v1's Plex beta input ran `re.search(filter, title, IGNORECASE)`. The grilled Spotify input dropped regexes for names and links (#136 decision 8), and the same question will reach the Spotify and Deezer mappings.
   - **Recommendation:** no regex in v2. The importer skips an input applet whose filter is non-blank and reports it with its filter (ADR-0017 §6), so the user rebuilds it with `chosen`. Importing it as `all` was rejected, because the output would then create or overwrite every playlist the filter used to exclude.
   - Alternative: a third variant, `matching`, holding a JavaScript regex run case-insensitively against titles, which the importer fills verbatim. Python and JavaScript regexes agree for plain patterns. On Plex the only person a slow pattern hurts is the self-hoster, but the same variant on Spotify or Deezer would run user regexes on a hosted server. ⚑ multi-tenancy for those two.
2. **Smart playlists.** v1 read them, since it filtered only on `playlistType`. A smart playlist such as "All Music" can hold an entire library.
   - **Recommendation:** read them like any playlist. The user picks what to read, and `exclude` drops the big ones.
   - Alternative: an `includeSmart` boolean on `all`, default false.
3. **Two playlists with one title under `chosen`.** The test server holds exactly this: a smart and an ordinary playlist, both "ultrasonics Plex test".
   - **Recommendation:** read both, with a `warn`. Two same-named playlists then reach the outputs, which the merger or the output's own ambiguity rule (#114) handles.
   - Alternative: skip the name with a warning, as the output skips an ambiguous target.

## Testing Decisions

- Through the plugin's `inputs` handler and `runConformance` only. Assertions are on the song dict, log lines and the requests the fake received (#114's approach).
- **The seam is HTTP.** The output's in-process fake on `Bun.serve` gains `/playlists?playlistType=audio` and paged `/playlists/<k>/items`. New fixtures are recorded from the test server with the token absent and the identity scrubbed: the playlist list (smart and ordinary sharing a title), a three-item playlist read in two pages, and a 404.
- **Conformance:** fixtures for `inputs` settings (valid: `all`, `all` with `exclude`, `chosen`; invalid: blank `chosen`, an unknown `source`). Strict song-dict validation and key parity pass with both components.
- **Cases:** `all` and `exclude`, case-insensitive; `chosen` order kept, a missing name warns, a shared name reads both; no item request is made for a filtered-out playlist (#15); paging reads every page in order; `name`, `description` and the `plex:<id>` key are right and a blank summary is absent; an untitled item and a non-track item are skipped with one summary warning; a 404 on one playlist's items skips it; 401 throws; unreachable throws; no URL, log line or error holds the token.
- **The import mapping** against its v1 fixture, through the importer's public entry point.

## Out of Scope

- Reaching a home Plex from the hosted tier (the home agent, ADR-0002 §3).
- Path translation between Plex's and ultrasonics' view of the music folder.
- Playlist artwork (#52).
- Reading a whole library as one playlist. v1 never did.
- A live playlist picker (#77: deferred).

## Further Notes

- **No change to the plugin SDK contract or the `AuthProvider` surface.** If the build finds it needs one, it stops and asks.
- **Plex's official reference** ([developer.plex.tv/pms](https://developer.plex.tv/pms/), API 1.2.3, PMS 1.43.4 and later) says playlist items "should be paged by clients", and warns that a response may hold a different number of items than asked. The reader stops on `totalSize` or an empty page, whichever comes first. The reference also has `smart=0|1` on `GET /playlists`, which open question 2's alternative would use. It doesn't mention `mbid://` or `includeGuids`; the finding above comes from the test server.
- **⚑ For Cal, not for this spec: Plex's auth is moving.** The same reference now recommends JWT device auth: an Ed25519 key per device, tokens that expire after seven days, refreshed with a signed nonce. The pasted `X-Plex-Token` is still documented, as "Traditional Token Authentication (Legacy)", and still works on the test server. Converting a legacy token to a JWT expires the legacy one, so a user who signs another app in with JWT may find ultrasonics' token refused. Moving the `plex` grant to JWT would change ADR-0013's `token` flow into something with a refresh, a stored private key and a PIN sign-in. That's an auth-layer decision, and this spec doesn't make it.
- The output's existing-playlist read gains paging as a side effect. Its tests should still pass unchanged, and one case should cover a two-page existing playlist.

## Planned tickets and acceptance criteria

**One ticket: "Plex input"**, blocked by nothing open (#114 is delivered). It is blocked by the importer's base ticket only for its mapping half; if that hasn't landed, the mapping moves to a follow-up ticket under this spec.

- [ ] `plex` has `inputs` and `outputs`; `runConformance` passes for both, including key parity and strict song-dict validation.
- [ ] `all`, `all` with `exclude`, and `chosen` read the right playlists, case-insensitively, and only audio playlists.
- [ ] No items request is made for a playlist the settings exclude (#15).
- [ ] Every emitted playlist has `name`, never `title` (#59), and its id under `plex:<machine identifier>`.
- [ ] A playlist longer than one page is read in full and in order.
- [ ] An untitled or non-track item is skipped with one summary warning per playlist; the rest of the playlist reads.
- [ ] A missing chosen name warns; a 404 on one playlist's items skips it; 401 and an unreachable server throw before any playlist is emitted.
- [ ] No request URL, log line or error contains the token.
- [ ] `id.musicbrainz` is never set from Plex's `mbid://` Guid.
- [ ] The v1 mapping imports a blank-filter input applet as `all`, applies open question 1's answer to a non-blank filter, and is tested against a v1 fixture (ADR-0017 §5).
- [ ] `bun run test` and `bun run check` are green for `plugin-plex` and the importer.
