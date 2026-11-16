# Draft spec: the local music database plugin

> Draft for grilling, not yet filed. Phase 2 (plugin parity). Points marked **⚑** touch the auth
> layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md, checkpoint
> gates). Where filesystem plugins may read is the local playlists draft's open question 1, and
> this draft assumes its recommendation.

## Problem Statement

A song from Spotify has no file. To write a Spotify playlist as a local `.m3u`, or to hand Plex a
song it can match by path, something has to find the local file that holds the same recording and
put its path in `location`. In v1 that was `local music database`, a modifier that kept a tag cache
of the music folder and matched songs against it.

v1's version had these problems:

- Its `fuzzy_ratio` was a free-text field read with `float(...)`, so a blank or non-number crashed
  the run. The same class of crash was the most-reported in the backlog (#47, must-still-work #3).
- Candidates came from SQL `instr()` substring searches on lowercased fields, tried in a fixed
  order. The first candidate scoring over the threshold won, which is order-dependent, not the
  best match.
- Its cache was never pruned, so deleted files stayed as candidates and could be written into
  playlists.
- Its `test()` checked that the folder existed, and v2's server never calls `test()` for a plugin
  without auth (Further Notes).

v2 now has a shared matcher (`@ultrasonics/matcher`, `bestMatch`) and no user-facing thresholds
(map decision #104). This plugin should use it rather than carry its own scoring.

## Solution

A new plugin, `local-music-database`, with a `modifiers` component in `playlists` mode and no auth.
Each run it:

1. brings an index of the account's music folder up to date, rescanning only files whose size or
   modification time changed, and dropping files that are gone;
2. for every song with no `location`, fetches a short list of candidates from the index by ISRC,
   MusicBrainz id and normalised title;
3. passes the song and its candidates to `bestMatch`, and sets `location` from the winner;
4. returns the song dict, changed only in `location`.

The music folder is an account-wide setting. The index is a SQLite file in the plugin's
`ctx.configDir`. The plugin reads tags with the mapping the local playlists plugin exports.

## User Stories

1. As a self-hoster, I want to set my music folder once, so that every applet that uses this
   modifier uses it.
2. As a self-hoster, I want Spotify songs given the path of my matching local file, so that a
   local playlist output can write them.
3. As a self-hoster, I want ISRC and MusicBrainz ids used when my tags have them, so that exact
   matches never depend on fuzzy scoring.
4. As a self-hoster, I want the best candidate chosen, not the first one over a line, so that a live
   version doesn't beat the studio track because it sorted first.
5. As a self-hoster, I want no threshold to set, so that a blank field can't crash a run
   (must-still-work #3, #47).
6. As a self-hoster, I want songs that already have a location left alone, so that a local input's
   songs keep their own paths.
7. As a self-hoster, I want only changed files rescanned, so that a run against 50,000 files takes
   seconds after the first.
8. As a self-hoster, I want deleted files dropped from the index, so that a playlist never points
   at a file that's gone.
9. As a self-hoster, I want the first scan to log its progress, so that a long first run doesn't
   look hung.
10. As a self-hoster, I want an unreadable file skipped and counted, so that one corrupt file never
    aborts a scan (must-still-work #2).
11. As a self-hoster, I want a log line per playlist saying how many songs gained a location, so
    that I can see what the modifier did (ADR-0020: a modifier's effect "is visible by diffing").
12. As a self-hoster, I want a music folder that doesn't exist, or isn't set, to fail the run with a
    message naming the setting, rather than leave every song unmatched.
13. As a self-hoster running two applets at once, I want both to use the index safely (ADR-0011 §5
    allows concurrent applets).
14. As a v1 user, I want my music folder imported, and my old fuzzy ratio dropped quietly.
15. As a maintainer, I want the plugin to pass `runConformance` and its tests to run against a
    temporary folder of tiny tagged files.

## Implementation Decisions

### Package and registration

- `packages/plugins/local-music-database`, named `@ultrasonics/plugin-local-music-database`,
  depending on `@ultrasonics/plugin-sdk`, `@ultrasonics/matcher`,
  `@ultrasonics/plugin-local-playlists` (for its tag mapping, through that package's `exports`)
  and `zod`.
- `definePlugin` with `name: "local-music-database"`, `mode: ["playlists"]`, one `modifiers`
  handler, **no `auth`** and **no `test()`** (no server caller; see Further Notes).

### Settings

- `persistentSettings`: `{ musicDir: string }`, required, non-empty, absolute (a `.refine()`). An
  unset value makes the runner fail the run before plugin code, with an error naming the field
  (ADR-0019 §7: "A run with invalid settings fails before any plugin code runs"). Account-wide, as
  v1's `music_dir` was. Open question 3.
- `instanceSettings.modifiers`: an empty object, which renders no form (ADR-0019 §6).
- **No match threshold**, as in the Plex output (#114, map decision #104). The matcher owns it.

### The index ⚑ database schema (a plugin-private file, not `packages/db`)

- A `bun:sqlite` file at `<configDir>/library.db`. The handle lives and dies inside the handler,
  and never crosses the boundary (ADR-0010 §5's warning that a `bun:sqlite` handle "clones into a
  useless `{filename}`" applies to context fields, not to a plugin's own locals).
- One table of files: `path` (primary key), `size`, `mtimeMs`, and the song fields the tag mapping
  produces, with a normalised title column and indexes on `isrc`, `musicbrainz` and the normalised
  title. A `meta` table holds a schema version and the `musicDir` the index was built for.
- It is a cache. A version mismatch, a different `musicDir`, or a file that won't open as SQLite
  is deleted and rebuilt, with a `warn`. There are no migrations, and ADR-0009's migration rules
  don't apply. Open question 1.
- WAL mode and a busy timeout, so two concurrent runs serialise their writes (ADR-0011 §5).

### Scanning

1. Check `musicDir` exists and is a directory, or throw naming it. A throw from a modifier fails
   the run (ADR-0020 §5).
2. Walk `musicDir`: skip names starting with `.`, don't follow symlinked folders, and keep files
   whose extension the tag reader supports.
3. For each file, compare `size` and `mtimeMs` with the index. Read tags only for new or changed
   files. Delete rows for files the walk didn't see.
4. Write in batches inside transactions. Log `info` every 1,000 files read, and a summary at the end
   (read, unchanged, removed, unreadable).
5. An unreadable file is counted and skipped, with a `debug` line.

The 60-minute run deadline is reported, not enforced (ADR-0010 §3 constraint 7). A first scan of a
large library is the likeliest thing in Phase 2 to come close. The logs make that visible.

### Matching

For each song in each playlist without a `location`:

1. **Candidates**, each query capped at a fixed number:
   - rows with the song's ISRC;
   - rows with the song's `id.musicbrainz`;
   - rows whose normalised title equals the song's;
   - if all of those are empty, rows whose normalised title equals the song's title cut before its
     first bracket, dash or colon. That mirrors the Plex output's fallback query (#114).
2. Each row becomes a `Song` through the same tag mapping, with `location` set.
3. `bestMatch(song, candidates)` returns a winner or none. The plugin applies no threshold, scoring
   or tie-break of its own (as #114 decided for Plex).
4. A winner sets `location`. Nothing else changes. Missing songs are listed at `debug`, and each
   playlist gets one `info` line: "`<name>`: located 37 of 50".

The normalised title is lowercase, NFKD with combining marks removed, with punctuation collapsed to
spaces. It only selects candidates. The matcher judges them.

### Output of the handler

The handler returns a new `SongDictInput`, the input with `location` added where found. It doesn't
mutate `ctx.songs`. The runner then validates it (ADR-0021 §1).

### File access ⚑ multi-tenancy

As in the local playlists draft, open question 1: self-host only, the container's mounts as the
boundary. This plugin only **reads** `musicDir`, and only **writes** inside `ctx.configDir`, which
the server makes per account and per plugin (`<DATA_DIR>/accounts/<id>/plugins/local-music-database`).

### v1 import mapping (ADR-0017 §5)

A module accepting `local music database` at any version (v1 shipped 0.1).

- **Persistent:** `music_dir` → `musicDir`. `fuzzy_ratio` is dropped without comment. v2 has no
  threshold, and ADR-0022 §5 accepts that matching changes for v1 users ("The migration guide says
  so").
- **Instance:** v1's `builder()` returned `""`, so the stored data is empty. It maps to `{}`
  whatever it holds.
- **Not read:** v1's `library.db` (ADR-0017 §3 names it). The first v2 run rebuilds the index.
- The report reminds the user that `musicDir` names a path inside v1's container.
- **Fixture test:** a v1 database whose `plugins` row has both keys, and an applet using the
  modifier between a Spotify input and a local playlists output.

## Testing Decisions

- A good test drives the `modifiers` handler with a harness context, a temporary `configDir` and a
  temporary music folder, and asserts on the returned song dict and the log. It may open the index
  file only to set up a corrupt-file case.
- **Fixtures:** the local playlists package's tiny tagged files, copied into the temporary music
  folder, including two versions of one title (studio and live) and an ISRC-tagged file.
- **`runConformance`** with a persistent-settings fixture pointing at the seeded folder. Its default
  song dict's song that already has a `location` stays unchanged.
- **Cases:**
  - Matching: by ISRC; by MusicBrainz id; by title, where the studio file beats the live one
    because the matcher prefers it; the cut-title fallback; no match leaves the song without a
    `location`; a song with a location is untouched.
  - Scanning: a second run reads no tags (counted through the log summary); a touched file is
    re-read; a deleted file is removed and never matched; a hidden file and a symlinked folder are
    skipped; an unreadable file is counted.
  - Index: a different `musicDir` rebuilds; a corrupt file rebuilds with a `warn`.
  - Failure: an unset or missing `musicDir` fails, naming the setting.
  - Concurrency: two handlers run in parallel against one `configDir`, and both finish.

## Out of Scope

- Writing anything except `location` into songs, such as filling in a missing ISRC from tags.
- A background or scheduled scan outside a run (open question 2).
- Matching against more than one music folder.
- Reading v1's `library.db`.
- Confidence scores or a review queue for doubtful matches (#32's request, which no phase owns).

## Open questions

Each has a recommendation. ⚑ marks a checkpoint.

1. **A plugin-private SQLite file.** ⚑ database schema. ADR-0009 governs "the v2 database", and
   this would be a second database the account owns, outside `packages/db`, its scoping and its
   migrations. v1 did the same, and ADR-0017 §3 already counts "the local music database's SQLite
   file" as plugin data.
   - **Recommended:** allow it, as a cache in `ctx.configDir`, rebuilt rather than migrated. It
     holds nothing that can't be recomputed from the music folder, and it is per account by the
     directory it lives in.
   - Alternatives:
     - A JSON file. No SQL candidate queries, so every run loads the whole index into memory.
     - No cache; read tags every run. Correct, and minutes per run on a real library.
     - A table in the v2 database. That needs a migration, a scoped store method, and puts a
       plugin's private cache in the shared schema. ADR-level for no gain.
2. **When the scan happens.** v1 scanned at the start of every run.
   - **Recommended:** every run, incrementally, as v1 did. After the first scan it costs one
     `stat` per file.
   - Alternatives: skip the rescan if the last one finished less than N minutes ago (a setting
     nobody asked for); or a background scan, which would make this a server capability.
3. **Account-wide or per applet?** v1's `music_dir` was persistent, so one library per user.
   - **Recommended:** keep it persistent. One index per account, shared by every applet.
   - Alternative: an instance setting. Each applet could point at a different folder, at the cost
     of one index per folder and a less obvious settings page.
4. **Should a found file overwrite an existing `location`?** v1 left songs with a location alone.
   - **Recommended:** leave them, as v1 did. A song's location from its own input is the better
     claim.
   - Alternative: an instance toggle to relocate everything, which would let a Plex input's paths be
     swapped for local ones. Nobody has asked.

## Further Notes

- **Tickets: one.** One handler, one index, one mapping. Blocked by the local playlists input
  ticket, which exports the tag mapping.
- **Decided here, worth a glance:**
  - The index is pruned, which v1's never was.
  - Candidates come from ISRC, MusicBrainz id and normalised title, then `bestMatch` picks one.
  - A missing `musicDir` fails the run rather than silently locating nothing.
- **No change to the plugin SDK contract.** If the build finds it needs one, it stops and asks.
- **`test()` and plugins without auth.** v1's `test()` checked the folder existed. ADR-0012 §5 used
  this plugin as its example of a `test()` that checks more than credentials. v2's server calls
  `test()` only for a configured grant, so this plugin has none, and its check moves to run time.
  Worth Cal's call whether the settings page should offer a test for non-auth plugins. That is
  server work, outside this cell.

## Planned tickets

1. **The local music database.** Package, registration, the index, scanning, matching, the v1
   mapping and its fixture test.
   - [ ] A song gains the `location` of its matching file by ISRC, MusicBrainz id or title.
   - [ ] Songs with a `location` are unchanged.
   - [ ] A second run re-reads no unchanged file, and deleted files are never matched.
   - [ ] A missing or unset `musicDir` fails the run naming the setting.
   - [ ] A corrupt or stale index is rebuilt with a `warn`.
   - [ ] Two concurrent runs both complete.
   - [ ] `runConformance` passes.
   - [ ] The v1 fixture maps `music_dir` and drops `fuzzy_ratio`.
   - [ ] `/verify`: a Spotify playlist through this modifier into a local playlists output writes
     paths to real files.
