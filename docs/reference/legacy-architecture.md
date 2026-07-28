# Reference — Legacy (v1) architecture

Source of truth for porting v1 → v2. Everything here describes the **existing Python app** as it
stands on `master`, read directly from source. When the port needs to know "what did v1 actually
do", this is the answer. Behaviour to preserve exactly (the song dict, fuzzymatch) is called out;
everything else is being replaced (ADR-0001).

## Engine overview

v1 is Flask + Flask-SocketIO. `app.py` wires four modules in order: `database.Core().connect()`,
`plugins.plugin_gather()`, `scheduler.scheduler_start()`, `webapp.server_start()`. Total engine is
~1,200 LOC; the rest is ~16 plugins and the frontend.

- **`plugins.py`** (327 LOC) — plugin discovery (walks `./plugins` and
  `./ultrasonics/official_plugins`, `importlib`-imports `up_*.py`), and the **applet runner**.
- **`database.py`** (377 LOC) — SQLite. Three tables: `ultrasonics(key,value)` (globals),
  `plugins(id,plugin,version,settings)`, `applets(id,lastrun,data)`. Applets and plugin settings
  are stored as **Python `repr` strings** and read back with `ast.literal_eval` — replaced in v2
  by a typed schema + JSON columns (ADR-0001).
- **`scheduler.py`** (89 LOC) — polls triggers at `trigger_poll` seconds (default 120).
- **`webapp.py`** (292 LOC) — Flask routes + SocketIO.
- **`tools/`** — `fuzzymatch`, `name_filter`, `local_tags` (mutagen), `api_key`, `version_check`,
  `random_words`.

### Applet runner semantics (preserve)

From `applet_run()`. An applet is `{ inputs[], modifiers[], outputs[], triggers[] }`:

1. **Inputs** — each input plugin's `run(component="inputs")` returns playlists; all are appended
   into one `songs_dict` list.
2. **Modifiers** — each receives the whole `songs_dict` and returns a replacement.
3. **Outputs** — each receives the final `songs_dict`; returns nothing.

Records `lastrun = { time, result }`. Fails the whole applet if any input or output is missing.

**Known bug to fix in the port:** `applet_trigger_run()` requires *all* triggers to fire (AND) —
the comment admits it should be OR. Fix in v2 (`CONTEXT.md`, "Trigger").

### The song dict (preserve exactly — ADR-0006)

The interchange format between every plugin. A list of playlists:

```jsonc
{
  "name": "New Music",
  "id": { "spotify": "57BF…" },          // per-service playlist ids
  "songs": [
    {
      "title": "Never Be Like You",
      "artists": ["Flume", "Kai"],
      "album": "Skin",
      "date": "2016-05-27",
      "isrc": "AUFF01500784",
      "location": "/media/music/Flume/Skin/Never Be Like You.m4a",
      "id": { "spotify": "476j…", "deezer": "117176358" }
    }
  ]
}
```

Only `title` and `artists` are reliably present. `location`, `isrc`, `id` are the hard-match keys;
`duration` occasionally appears. In v2 this is a Zod schema, otherwise identical.

### Auth: the ultrasonics-api proxy (being deleted — ADR-0005)

`global_settings["api_url"]` points at **ultrasonics-api**, a hosted Heroku proxy that held secret
API keys for Spotify / Last.fm / Deezer. Dead since Nov 2022. Spotify & Spotify-mixer additionally
send a rotating `ultrasonics_auth_hash` from `api_key.get_hash(True)` (a 30s time-windowed hash
built from a baked-in secret + the latest `xdgfx/ultrasonics` commit SHA). v2 replaces all of this
with `AuthProvider` (BYO/PKCE/Proxy).

---

## fuzzymatch — source of truth (ADR-0006)

`tools/fuzzymatch.py`. Two entry points: `duplicate(song, song_list, threshold) → bool` and
`similarity(a, b) → float 0–100`. **Port the code, not the docstring** — the docstring's
"35/35/20/10" percentages are wrong; the executed integer weights below are authoritative.

### Hard-match keys (short-circuit before any fuzzy scoring)

Checked in order; any hit returns immediately (`True` / `100`):

1. **`location`** — exact match after `.strip()`. Overrides everything.
2. **`isrc`** — exact match after `.strip()`. (In `similarity()`, isrc is *also* a weighted field
   of 10, not only a hard key.)
3. **`id`** — per-service exact match; any service key matching returns 100/True.

### Fuzzy field scores

| Field | fuzzywuzzy function | Notes |
|---|---|---|
| `title` | `fuzz.ratio` | cleaned with cutoff regexes; skipped in `similarity()` when ISRC already matched |
| `album` | `fuzz.ratio` | cleaned with cutoff regexes |
| `date` | `fuzz.token_set_ratio` | |
| `artist` | `fuzz.partial_token_sort_ratio` | artists joined + lowercased; partial to tolerate missing artists |
| `isrc` | exact equality × 100 | weighted field, `similarity()` only |

### Weights (the actual code)

- **`duplicate()`**: `{ title: 8, artist: 8, album: 2, date: 1 }`.
- **`similarity()`**: `{ isrc: 10, title: 8, artist: 8, album: 2, date: 1 }`.

Score = `Σ(field/100 × weight)`, normalised by `corrector = Σ weight` over **only present fields**
(missing-field correction). `corrector == 0` → `False`. `duplicate()` returns `True` as soon as a
candidate exceeds `threshold`.

### Cutoff regexes (feat./remix cleaning) — applied to `title` and `album` before ratio

```
cutoff_regex[0] = "[([](feat|ft|featuring|original|prod).+?[)\]]"
cutoff_regex[1] = "[ (\- )\-]+(feat|ft|featuring|original|prod).+?(?=[(\n])"
```

Case-insensitive. Procedure: `sub(regex[0], "", value) + "\n"`, then `sub(regex[1], " ", …).strip()`
(also `.lower()` in `similarity`). The appended `"\n"` is deliberate — `regex[1]`'s lookahead
`(?=[(\n])` needs it to terminate a trailing feat/remix segment. **These same two regexes are
copy-pasted into each service `search()` (spotify, spotify-mixer, deezer)** to clean query strings.
Centralise them in the port so they can't drift.

---

## Plugin catalogue

The plugin contract: a `handshake` dict (`name`, `description`, `type`, `mode`, `version`,
`settings`) plus `run(settings_dict, **kwargs)`, `builder(**kwargs)`, and optional
`test(database, **kwargs)`. `settings` = persistent/global (the `database` kwarg); `builder()`
returns per-applet instance settings; both frequently branch on `component`.

### spotify — inputs, outputs · playlists (+saved)
Spotify Web API via **spotipy**. **Needs proxy** (OAuth renew + `get_hash`). OAuth refresh token in
`database["auth"]`; access tokens cached in `config/up_spotify/up_spotify.bz2`. Match order in
`search()`: Spotify ID → ISRC query (`isrc:…`) → `track:… album:…` + per-artist queries; results
deduped then scored with `fuzzymatch.similarity`. Pagination wrappers (playlists 50, tracks 100,
saved 20). **Append-only** unless `existing_playlists == "Update"`; adds in batches of 100. Saved-
songs mode keeps a per-applet SQLite of seen ids. `request()` auto-renews token once on
`SpotifyException`. **Complexity: hard.**

### spotify mixer — modifiers · playlists, songs
Shares spotify's OAuth + `.bz2` cache. **Needs proxy.** Searches each input song for a seed id,
caps to 50 random seeds, chunks by 5, calls `sp.recommendations(seed_tracks, limit=100)`; songs
recurring across batches are promoted, filled to `playlist_length` (default 50). Overwrites target
playlists. **Complexity: hard.**

### deezer — inputs, outputs · playlists
Deezer API via raw `requests`; token parsed from `database["auth"]`. Proxy needed for the auth flow
only (API calls hit `api.deezer.com` directly). `api()` helper retries once after 5s on a status-`4`
quirk. `search()`: ID → ISRC endpoint → `track:"…" album:"…"` + per-artist; fuzzy-scored, enriched
via per-track `/track/{id}`. `"next"`-URL pagination, dedupe via `fuzzymatch.similarity`, batches of
100. **Complexity: moderate–hard.**

### lastfm — inputs · songs
Last.fm API **via proxy** (`{api_url}lastfm`); no user key. Loved/Recent/Top; paginates 50/page.
**Rate-limit:** on HTTP 429 sleeps 60s and retries. Enriches missing albums via `track.getinfo`.
`test()` validates username via `user.getinfo`. **Complexity: moderate.**

### plex — inputs, outputs · playlists  *(legacy XML/m3u)*
Plex HTTP API (XML) + mutagen. Plex token + server URL; no proxy. **Path translation** between
Plex-side and ultrasonics-side music roots (`plex_prepend`/`ultrasonics_prepend`, `\`↔`/`). Output
writes a temp `.m3u` into `.ultrasonics_tmp` in the music dir then POSTs to `/playlists/upload`;
**overwrites**. `test()` checks reachability + both dirs + temp-folder permissions. **Complexity:
hard.**

### plex beta — inputs, outputs · playlists  *(PlexAPI rewrite; the one to port)*
Built on **PlexAPI**; no path translation (PlexAPI resolves locations). Token + server URL. Matches
playlists by **title**; searches preferred music library first then falls back, scoring with
`fuzzymatch.similarity` against instance `fuzzy_ratio`. Update mode diffs items; else appends /
creates. Builds song dict with `id={"plex": track.key}`, `location`, `duration`. **Prefer this over
legacy `plex` for the port. Complexity: moderate.**

### local playlists — inputs, outputs · playlists
Local `.m3u` only; filesystem + mutagen + `name_filter`. Same prepend/`convert_path` translation as
plex. Output **backs up** the whole playlist dir to `config/…/backups/{applet_id}/{timestamp}` with
retention pruning, sanitises names, **overwrites**. **Complexity: moderate.**

### local music database — modifiers · playlists
Bridges services to local files by adding `location`. SQLite library cache at `config/…/library.db`;
mutagen + fuzzymatch. Incremental scan of `music_dir` keyed by `location` + mtime. For each song
without `location`, searches DB by `["isrc","title","artists","album"]` (SQL `instr()` substring),
scores with `fuzzymatch.similarity`, accepts first over `fuzzy_ratio` (default 90). **Complexity:
moderate.**

### playlist merger — modifiers · playlists
fuzzymatch only. Merges playlists sharing a `name`: unions ids, appends songs from A not
`fuzzymatch.duplicate` of B. **Required whenever an applet has more than one input.** Effective
ratio: instance → global → 90. **Complexity: trivial–moderate.**

### custom file — outputs · songs, playlists
Writes a file with a per-song `pattern` supporting `{title}`, `{artist}`, `{album}`, `{isrc}`,
`{location}`, `{id.<service>}`. Songs missing a referenced field are skipped. Overwrite|Append.
**Complexity: trivial.**

### Utility / trigger plugins
- **log tracks** — outputs; dumps `songs_dict` as JSON to the log. Debug. *(trivial)*
- **rickroll** — modifiers; replaces every song with a hard-coded Rick Astley track. Joke. *(trivial)*
- **system command** — outputs; `os.system(command)`. **Arbitrary command execution — security
  review required in the port.** *(trivial, sensitive)*
- **webhook** — triggers; spins a **blocking Flask server** until one GET hits `path`, then shuts
  down (deprecated Werkzeug shutdown — re-architect around the Bun server). *(moderate)*
- **time trigger** — triggers; recurring interval from a `start_timestamp`, blocking `time.sleep`
  until due, SQLite runtime store. Interval table: Hours 3600 / Days 86400 / Weeks 604800 / Months
  2628000. Re-architect around the v2 scheduler rather than blocking. *(moderate)*
- **skeleton** — the sample/template. Do not port as a functional plugin.

## Parity matrix

| Plugin | Types | Mode | External dep | Needs proxy? | Port complexity |
|---|---|---|---|---|---|
| spotify | inputs, outputs | playlists (+saved) | spotipy, SQLite, bz2 cache | **yes** | hard |
| spotify mixer | modifiers | playlists, songs | spotipy (recommendations) | **yes** | hard |
| deezer | inputs, outputs | playlists | Deezer API (requests) | auth only | moderate–hard |
| lastfm | inputs | songs | Last.fm API via proxy | **yes** | moderate |
| plex | inputs, outputs | playlists | Plex XML API + mutagen | no | hard |
| plex beta | inputs, outputs | playlists | PlexAPI + fuzzymatch | no | moderate |
| local playlists | inputs, outputs | playlists | filesystem + mutagen | no | moderate |
| local music database | modifiers | playlists | SQLite + mutagen + fuzzymatch | no | moderate |
| playlist merger | modifiers | playlists | fuzzymatch | no | trivial–moderate |
| custom file | outputs | songs, playlists | filesystem | no | trivial |
| log tracks | outputs | playlists | none | no | trivial |
| rickroll | modifiers | playlists | none | no | trivial |
| system command | outputs | songs, playlists | OS shell | no | trivial (security) |
| webhook | triggers | playlists, songs | Flask/Werkzeug | no | moderate |
| time trigger | triggers | playlists, songs | SQLite; blocking sleep | no | moderate |

## Shared tools → dependents

| Tool | Purpose | Used by |
|---|---|---|
| **fuzzymatch** | weighted fuzzy matching (`similarity`, `duplicate`) | spotify, spotify-mixer, deezer, plex-beta, local-music-database, playlist-merger |
| **name_filter** | regex filter of playlists by name (case-insensitive `re.match`) | spotify, deezer, local-playlists |
| **local_tags** | read tags via mutagen (mp3/m4a/flac); adds `location` | local-playlists, local-music-database, plex |
| **api_key** | obfuscated rotating `ultrasonics_auth_hash` for the proxy | spotify, spotify-mixer (deezer imports, unused) |
| **version_check** | decide if plugin settings migrate across a minor/patch bump | core settings/migration layer |

## Port gotchas (flagged for v2)

- **spotify + spotify-mixer share one Spotify auth**. Port against a single shared Spotify provider.
- **feat./remix cutoff regexes are duplicated** in fuzzymatch and each service `search()`.
  Centralise.
- `fuzzy_ratio` default is **90** everywhere (`float(db.get("fuzzy_ratio") or 90)`), despite the
  setting's placeholder being the string `"Recommended: 90"`.
- Blocking designs (**webhook**, **time trigger**) must be re-architected around the v2 server /
  scheduler, not ported literally.
- **system command** is arbitrary code execution — decide its place (if any) in a multi-tenant
  hosted world (ADR-0002/0003) before porting.
- v1 plugins reach into `app._ultrasonics["config_dir"]`; the config-dir location was part of the
  runtime contract. v2 passes it through typed context instead.
