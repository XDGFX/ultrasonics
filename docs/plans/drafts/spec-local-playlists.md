# Draft spec: the local playlists plugin

> Draft for grilling, not yet filed. Phase 2 (plugin parity). Points marked **⚑** touch the auth
> layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md, checkpoint
> gates). This spec owns the shared question of where filesystem plugins may read and write (open
> question 1). The local music database and custom file drafts point back to it.

## Problem Statement

Self-hosters keep playlists as `.m3u` files beside their music, and want them synced to and from
services: local to Plex was the case in #49, and Spotify to a folder of playlists is the reverse.
v1's `local playlists` did both directions. v2 has no filesystem plugin yet.

v1's version failed in ways the backlog recorded, and in ways its source shows:

- A playlist file that wasn't UTF-8, or a hidden file such as macOS's `._Name.m3u`, killed the whole
  read (#49, must-still-work #2 and #7).
- When tags couldn't be read, it logged the error and appended the *previous* song again, or
  crashed on the first song (`up_local playlists.py`, input loop).
- A missing file was skipped without a word, so a wrong path mapping produced empty playlists and a
  "successful" run.
- The output copied the whole playlist directory into `config/` on every run, whatever else lived
  in it, and then overwrote every playlist.
- The path mapping used `str.replace`, so it rewrote the prefix wherever it appeared in a path, not
  only at the start.
- Its filter's help text promised a substring match (`'disco'` matches `'nu_disco'`) and the code
  did an anchored `re.match`.

## Solution

A new plugin, `local-playlists`, in its own package, with `inputs` and `outputs` components in
`playlists` mode and no auth. It reads and writes `.m3u` and `.m3u8` files in one folder chosen per
applet.

- **Input:** for each playlist file, it resolves each entry to a file ultrasonics can open, reads
  its tags, and emits a song carrying `location` and whatever the tags hold.
- **Output:** for each playlist it receives, it writes the songs that carry a `location` as an
  extended M3U file, translating each path back into the form the user's player expects, and
  returns an `OutputResult`.
- **Path mapping:** an optional pair of account-wide roots translates between the paths the
  player's playlists use and the paths ultrasonics sees. This is v1's prepend pair, and ADR-0012 §6
  already places the equivalent Plex pair in `persistentSettings`.

The plugin is registered as `local-playlists` in `officialPlugins` (ADR-0012 §4).

## User Stories

**Reading**

1. As a self-hoster, I want to choose a playlists folder, so that every `.m3u` and `.m3u8` in it
   becomes a playlist named after its file.
2. As a self-hoster with nested folders, I want to include subfolders, so that `Rock/Classics.m3u`
   is read too.
3. As a self-hoster, I want to filter playlists by name, so that only the ones I choose sync.
4. As a self-hoster, I want hidden files ignored, so that macOS's `._Name.m3u` never breaks a run
   (#49, must-still-work #7).
5. As a self-hoster with old playlists in Latin-1, I want them read correctly, so that non-ASCII
   paths still resolve (#49, must-still-work #7).
6. As a self-hoster, I want relative entries resolved against the playlist's own folder, which is
   how players write them.
7. As a self-hoster whose player sees my music at `D:/Music` while ultrasonics sees `/music`, I
   want to set that pair once, so that every playlist's paths resolve.
8. As a self-hoster, I want each song's title, artists, album, date, ISRC, duration and MusicBrainz
   recording id read from its tags, so that the matcher has the strongest keys the file holds
   (ADR-0023).
9. As a self-hoster with untagged files, I want them carried with their filename as the title and
   no artists, so that they still reach the output (ADR-0023 §3: "so untagged local files
   survive").
10. As a self-hoster, I want a file that can't be found skipped with a warning, and a summary per
    playlist, so that a wrong mapping is obvious rather than silent.
11. As a self-hoster, I want a playlist where *no* entry resolved to warn that the path mapping is
    probably wrong.
12. As a self-hoster, I want one unreadable playlist file skipped with a warning while the rest read
    (must-still-work #2).
13. As a self-hoster, I want a playlists folder that doesn't exist to fail the run with a message
    naming it, rather than sync nothing and report success.

**Writing**

14. As a self-hoster, I want each playlist written to `<folder>/<name>.m3u8`, or to the existing
    `<name>.m3u` or `<name>.m3u8` if there is one, so that my player sees the same file updated.
15. As a self-hoster, I want playlist names sanitised into valid filenames, including the
    characters Windows forbids, so that `AC/DC: Best Of` still writes (must-still-work #7).
16. As a self-hoster, I want the file to hold exactly the songs that carry a location, in order,
    with each path translated back to my player's form.
17. As a self-hoster, I want `#EXTINF` lines with duration, artist and title, so that my player
    shows names before it scans the files.
18. As a self-hoster, I want songs with no location listed as unmatched, so that the run shows
    "wrote 40 of 50" (must-still-work #8, ADR-0020 §4).
19. As a self-hoster, I want an empty playlist, or one with no locations at all, skipped with a
    reason rather than written as an empty file (must-still-work #1).
20. As a self-hoster, I want an interrupted write never to leave a half-written playlist.
21. As a self-hoster, I want the file my playlist replaced kept as a backup, so that a sync never
    costs me a playlist I edited by hand (open question 3).
22. As a self-hoster, I want one playlist that can't be written reported as failed while the rest
    write (must-still-work #2, ADR-0020 §3).
23. As a self-hoster, I want an output folder that doesn't exist to fail the run before any file is
    touched.

**Upgrading and maintaining**

24. As a v1 user, I want my local playlists applets and path mapping imported (ADR-0017 §5).
25. As a maintainer, I want the plugin to pass `runConformance`, and its tests to run against
    temporary folders, with no fixture outside the package.

## Implementation Decisions

### Package and registration

- `packages/plugins/local-playlists`, named `@ultrasonics/plugin-local-playlists`, depending on
  `@ultrasonics/plugin-sdk`, `zod` and a tag reader (below). One package per plugin (ADR-0014 §6).
- `definePlugin` with `name: "local-playlists"`, `mode: ["playlists"]`, and `inputs` and `outputs`
  handlers. **No `auth`**: there is no service and no secret (ADR-0012 §6's rule: nothing here is
  needed to open an authenticated connection). `officialPlugins` gains the entry.
- **No `test()`.** The server calls `test()` only from the service routes, when a grant is
  configured (`packages/server/src/service-routes.ts`). A plugin with no auth has no caller, so the
  checks v1 might have put there happen at run time instead. ADR-0012 §5 assumed `test()` would
  serve local plugins too ("`local music database` tests a local database"), and the built server
  doesn't do that. See Further Notes.

### Persistent settings: the path mapping

A flat object (ADR-0019 §3), both fields optional, with a `.refine()` requiring both or neither:

- `playlistRoot`: the music folder as the player's playlists name it, for example `D:/Music`.
- `localRoot`: the same folder as ultrasonics sees it, for example `/music`.

Translation is a **prefix** match on whole path segments, never a substring replace. Separators
convert when exactly one side is Windows-shaped (by shape, as `toFileUri` does, v1 #22). An entry
outside `playlistRoot` is used as written. Account-wide, because the mapping describes the user's
machines, not one applet. That follows ADR-0012 §6, which put Plex's `plex_prepend` and
`ultrasonics_prepend` in `persistentSettings`.

### Instance settings

`inputs`:

- `dir`: a non-empty string, the playlists folder. Must be absolute (a `.refine()` using the same
  shape test as `toFileUri`).
- `recursive`: boolean, default `false`.
- `filter`: optional string, a regular expression matched case-insensitively against the playlist
  name, **unanchored**, so `disco` matches `nu_disco` as v1's help text promised. A `.refine()`
  rejects a pattern that doesn't compile (ADR-0019 §3: refinements run on the server). Open
  question 2.

`outputs`:

- `dir`: as above.
- `backups`: an enum of `0`, `3`, `5` or `10` as strings, default `3`, with a `warning` that the
  output replaces each playlist's contents. Shape depends on open question 3.

### Reading (`run.inputs`)

1. List `dir` (recursively if set). A missing or unreadable `dir` throws, naming the path. Skip
   names starting with `.`. Keep `.m3u` and `.m3u8`, compared case-insensitively.
2. Apply `filter` to the file's stem. Sort by relative path so the order is stable.
3. Decode each file: `.m3u8` as UTF-8; `.m3u` as UTF-8, falling back to Windows-1252 when the bytes
   aren't valid UTF-8. A leading BOM is dropped. A file that can't be read is skipped with a
   `warn`, and the rest carry on (must-still-work #2).
4. For each line: skip blanks and `#` lines. A `file://` entry is decoded with `fromFileUri`. An
   `http(s)://` entry is skipped and counted. A relative entry is resolved against the playlist's
   folder. Then the path mapping applies, from `playlistRoot` to `localRoot`.
5. A path that doesn't exist is skipped and counted. If every entry in a playlist was skipped, log
   a `warn` that suggests checking the path mapping.
6. Read tags (below). On failure the song is still carried, with the file's stem as `title` and
   `artists: []`, and a `debug` line. v1 appended the wrong song here.
7. Emit `{ name: <stem>, id: {}, songs }`. Repeated entries stay repeated. A playlist's skips are
   one summary `warn` per playlist with the counts, not one line per entry.

Inputs have no result of their own, so skips go through `ctx.log` (ADR-0020, "Results for inputs
and modifiers too. Deferred").

### Tags to a song

- `title`: the title tag, else the file stem.
- `artists`: the multi-value artists tag, else the artist tag split as the reader reports it, else
  `[]`.
- `album`, `date` (through `normaliseDate`), `isrc` (through `normaliseIsrc`), `durationMs` from the
  stream's duration.
- `id.musicbrainz` from the MusicBrainz recording id tag, where present. ADR-0023 §2 defines it as
  the recording MBID, and Picard-tagged libraries carry it, so it is the cheapest strong key
  available.
- `location`: `toFileUri` of the path ultrasonics opened. Open question 4 settles whose path this
  is.
- No `explicit`. File tags have no agreed explicit flag across formats, and absent means unknown
  (ADR-0023 §7).

The tag reader is `music-metadata` (MIT, pure TypeScript), which covers v1's mp3, m4a and flac,
plus ogg, opus and wav. `/research` confirms it runs under Bun and reads a file without loading it
whole, before the build. The shared tag mapping lives in this package and is exported for the
local music database, which reads the same tags.

### Writing (`run.outputs`)

1. Check `dir` exists and is a directory. If not, throw before writing anything (ADR-0020 §3: "An
   output throws only when it cannot work at all").
2. For each playlist, by position, inside its own error boundary:
   - **Empty** (no songs): `skipped`, code `empty`.
   - **Name:** sanitise the name: remove `\ / : * ? " < > |` and control characters, collapse
     whitespace, trim trailing dots and spaces, and prefix `_` to Windows reserved names (`CON`,
     `NUL`, `COM1` and so on). Empty after sanitising: `skipped`, code `invalid-name`. A second
     playlist in this run that sanitises to the same file: `skipped`, code `duplicate-name`. The
     song dict is not mutated (conformance's output-immutability check; v1 mutated it).
   - **Songs:** a song with a `location` that `fromFileUri` can read is written, mapped back from
     `localRoot` to `playlistRoot`. Every other song goes into `unmatched` by position.
   - **Nothing to write** (no song had a location): `skipped`, code `no-locations`, with a `warn`.
   - **Target:** `<dir>/<name>.m3u` if it exists, else `<dir>/<name>.m3u8`. Only the top level of
     `dir` is searched (open question 5).
   - **Backup** the existing target, as open question 3 decides.
   - **Write** `#EXTM3U`, then per song `#EXTINF:<seconds or -1>,<artists joined ", "> - <title>`
     and the path, as UTF-8 with `\n` endings, to a temporary file in `dir`, then rename it over the
     target. An error here is `failed`, code `write-error`, with the OS error's code in the message.
   - Otherwise `written`, with `unmatched`.
3. Return the `OutputResult`, with every playlist exactly once (ADR-0020 §2).

The output never checks that a path exists. The paths are the player's, which ultrasonics may not
be able to see.

### File access ⚑ multi-tenancy

How this plugin's paths are confined is open question 1. The draft assumes its recommendation:
self-host only, the container's mounts as the boundary, and these plugin-local guards:

- Every configured folder must be an absolute path.
- The output writes only files named `<sanitised name>.m3u` or `.m3u8` directly inside `dir`. A
  sanitised name holds no separator, so no playlist name can steer a write out of `dir` or onto a
  file that isn't a playlist, such as the v2 database.
- Backups go under `ctx.configDir`, which is this account's own directory
  (`<DATA_DIR>/accounts/<id>/plugins/local-playlists`).
- Symlinked folders are not followed when listing recursively, so a link loop can't hang a run.

### v1 import mapping (ADR-0017 §5)

A module in `@ultrasonics/v1-import` accepting `local playlists` at any version (v1 shipped 0.3).

- **Persistent:** `local_prepend` → `playlistRoot`, `ultrasonics_prepend` → `localRoot`. Both blank
  → neither. One blank → both dropped, and the report says so. The report also reminds the user
  that `localRoot` names a path inside v1's container, so their v2 volume must mount the music at
  the same place, or they edit it.
- **`inputs`:** `dir` → `dir`; `recursive` `"Yes"`/`"No"` → `true`/`false`; `filter` → `^(?:<filter>)`
  when not blank. The `^` keeps v1's anchored `re.match` behaviour under v2's unanchored rule.
  Python's `(?P<name>` becomes `(?<name>`. A filter that still doesn't compile as a JavaScript
  regular expression is imported as is, fails its schema, and shows in the form (ADR-0019 §7).
- **`outputs`:** `dir` → `dir`; `retention` `"No Backups"`/`"3 Backups"`/`"5 Backups"`/`"10 Backups"`
  → `backups` `"0"`/`"3"`/`"5"`/`"10"`. v1's output `recursive` is dropped, and the report notes it
  if it was `"Yes"`, since v2 writes only at the top level (open question 5).
- **Not read:** v1's `backups/` folder under its config directory (ADR-0017 §3's rule for on-disk
  files).
- **Fixture test:** a v1 database with one input and one output applet, a filter, a mapping, and a
  `recursive` output.

## Testing Decisions

- A good test drives the plugin's handlers with a context from the SDK harness, against a temporary
  folder, and asserts on the song dict it returns, the files it writes, the `OutputResult` and its
  log lines. No test reaches outside its temporary folder.
- **Fixtures** in `test/fixtures/`: a handful of tiny tagged audio files (a few hundred bytes each,
  generated once with silence), covering mp3, m4a, flac and one untagged file; and playlist files
  in UTF-8, UTF-8 with a BOM, Windows-1252, with relative entries, with `file://` entries and with
  `http` entries.
- **`runConformance`** with input fixtures (a temporary folder seeded from the fixtures) and output
  fixtures (a temporary `dir`). The default song dict's `file:///music/untagged.mp3` song is written
  as a path, and its empty playlist is `skipped` `empty`.
- **Input cases:** hidden files ignored; Windows-1252 decoded; relative entries resolved; mapping
  applied by prefix only, not mid-path; a missing file skipped and counted; every entry missing
  warns about the mapping; untagged file carried with its stem; filter unanchored and
  case-insensitive; an invalid regex rejected by the schema; a missing `dir` throws.
- **Output cases:** sanitising (`AC/DC: Best Of`, `CON`, trailing dot, emoji kept); two playlists
  that sanitise to one name; an existing `.m3u` rewritten in place; songs without location in
  `unmatched`; `no-locations` and `empty` skips; a read-only target is `failed` while the next
  playlist is `written`; an interrupted write (simulated by a failing rename) leaves the old file;
  `#EXTINF` lines; the mapping reversed.

## Out of Scope

- Writing relative paths. v1 wrote absolute paths, and players accept them.
- Deleting playlist files whose playlist no longer exists upstream. v1 never deleted either.
- Reading `#EXTINF` metadata to stand in for a file ultrasonics can't see.
- Other playlist formats (`.pls`, `.xspf`).
- A file watcher trigger (ADR-0011 §6: deferred, a server capability).

## Open questions

Each has a recommendation. ⚑ marks a checkpoint.

1. **Where may filesystem plugins read and write?** ⚑ multi-tenancy. This one question covers
   local playlists, the local music database and custom file. Today a plugin gets
   `ctx.configDir` and nothing else. There is no root, no sandbox, and no hosted flag
   (`packages/server`). A plugin running in-process can open any path the server process can.
   - **What the ADRs already settle:**
     - The hosted tier "launches **cloud-services-only** (Spotify, Deezer, Tidal, Apple Music,
       YouTube Music, Last.fm), because the cloud cannot reach a home Plex/local library"
       (ADR-0002 §2).
     - "Self-host has one account and does not support several users" (ADR-0015 §5).
     - So on the only deployment these plugins run on, there is no second tenant to reach. The
       risk is a misconfigured path, not another account.
   - **Recommended:**
     - No root confinement in Phase 2. The container's volume mounts are the boundary, and the
       self-host docs say to mount the music and playlist folders.
     - Plugin-local guards, as in this spec: absolute paths, writes only to sanitised names with
       the plugin's own extensions, nothing derived from a playlist name may hold a separator.
     - Record a Phase 5 requirement that the hosted catalogue excludes all three plugins, ⚑
       flagged for the hosted spec. The kill-switch (ADR-0002 §4) is the mechanism the ADRs
       already name.
     - The cheaper option fits ADR-0010's stance for Phase 1 code: "That is an accepted,
       reviewed-code-only risk for Phase 1, not an oversight."
   - Alternatives:
     - An operator setting listing allowed roots, such as `LOCAL_ROOTS`. ADR-0015 §1's house style
       argues for it ("Security properties are chosen explicitly, never by default"). But the
       plugin would need the roots in its context, a new `RunPayload` field, which is an SDK
       change ⚑ (ADR-0012, ADR-0004). Reading `process.env` from plugin code would avoid the SDK
       change, but it is a hidden channel past ADR-0010 constraint 6 ("No shared mutable state
       between plugin and host beyond `RunContext`").
     - A `path` kind in the settings metadata, so the server checks paths on save. A change to
       ADR-0019 §2's fixed vocabulary, so also an SDK change ⚑.
     - Either is additive later, when a home agent (A2) puts these plugins in reach of the hosted
       tier.
2. **The filter's semantics.** v1's help text and code disagreed.
   - **Recommended:** an unanchored, case-insensitive regular expression, as the help text said.
     The importer prefixes `^` so imported applets keep v1's behaviour.
   - Alternatives: anchored as v1's code did, which surprises anyone reading the help; or a plain
     substring with no regex, which is simpler but can't express "A or B".
3. **Backups.** v1 copied the whole `dir` into `config/` every run, with a retention of 0, 3, 5 or
   10 per applet. If `dir` was the music folder, that copied the music.
   - **Recommended:** before replacing a file, copy only that file to
     `<configDir>/backups/<appletId>/<timestamp>/`, and keep the newest N timestamps per applet,
     where N is the `backups` setting, default 3. The thing at risk is a hand-edited playlist the
     output overwrites, and this protects exactly that.
   - Alternatives:
     - Port v1's whole-folder copy. Faithful, and it can copy gigabytes.
     - No backups. Atomic writes already prevent a half-written file, and users have their own
       backups. Cheapest, but it removes a protection v1 users had.
4. **Whose path is `location`?** ⚑ the song dict's meaning, though not its shape. ADR-0023 §5 says
   `location` is "an absolute `file://` URI" and doesn't say whose view. The Plex output spec (#114)
   treats Plex's own paths as locations, untranslated.
   - **Recommended:** a song's `location` is the path as the plugin that set it can open it. For
     both local plugins that is ultrasonics' own view, which is why the mapping applies on the way
     in and out. A glossary line records it. A mismatch between namespaces only costs a hard-key
     match, which then falls back to tags.
   - Alternative: the player's view (store the raw `.m3u` entry). Then the local music database's
     locations and this plugin's would disagree.
5. **Searching subfolders on output.** v1's output, with `recursive`, overwrote a same-named
   playlist found anywhere under `dir`.
   - **Recommended:** top level only. Two files of the same name in different subfolders make the
     target ambiguous, and nobody asked for it. The importer reports affected applets.
   - Alternative: search the tree and skip a playlist as `ambiguous-target` when two match.

## Further Notes

- **Tickets: two.** Sized for `/code-review`, and the input's tag mapping is reused by the local
  music database's cell, so it lands first.
- **Decided here, worth a glance:**
  - `.m3u8` is read and is the extension for new files. Existing `.m3u` files are rewritten in
    place, as UTF-8, as v1 did.
  - `#EXTM3U` and `#EXTINF` lines are written, which v1 didn't.
  - A missing `dir` throws rather than producing an empty run.
  - `id.musicbrainz` is read from tags.
  - Untagged files are carried, titled by filename.
- **No change to the plugin SDK contract**, if open question 1 takes its recommendation. If the
  build finds it needs one, it stops and asks (AGENTS.md).
- **ADR-0012 §5 and the built server disagree about `test()`.** The ADR expected a local plugin's
  `test()` to check its folder, and the server only calls `test()` for a plugin with auth. This
  spec works around it with run-time checks. Whether non-auth plugins should get a test button is a
  server question for Cal, not this cell's.
- **Self-host docs** need a line on mounting music and playlist folders into the container. v2's
  `compose.yaml` mounts only `./config`.

## Planned tickets

1. **Read local playlists.** Package, registration, path mapping, input handler, the shared tag
   mapping, conformance for `inputs`.
   - [ ] Hidden files, Latin-1 files and relative entries handled as specified.
   - [ ] The mapping translates by prefix only.
   - [ ] Missing files are skipped with one summary `warn` per playlist, and an all-missing playlist
     warns about the mapping.
   - [ ] Untagged files are carried with their stem as title.
   - [ ] Tags give `title`, `artists`, `album`, `date`, `isrc`, `durationMs` and `id.musicbrainz`.
   - [ ] `runConformance` passes for `inputs`.
2. **Write local playlists, and the v1 mapping.** Output handler, backups, the importer module and
   its fixture test.
   - [ ] Each playlist appears once in the result, with `unmatched` positions for songs without a
     location.
   - [ ] Names sanitise, and nothing derived from a name escapes `dir`.
   - [ ] Writes are atomic, and backups follow open question 3.
   - [ ] `runConformance` passes for both components.
   - [ ] The v1 fixture maps as specified, including the `^` filter prefix.
   - [ ] `/verify`: a Spotify playlist piped through the local music database writes an `.m3u8`
     that a player opens.
