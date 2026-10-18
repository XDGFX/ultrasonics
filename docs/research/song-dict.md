# Research: the v2 song dict

**Date:** 2026-10-18
**Informs:** the song-dict design spec required by ADR-0022 (Phase 0)
**Builds on:** ADR-0020 (outputs return a result), ADR-0021 (the runner validates the song dict),
ADR-0022 (design the song dict fresh)
**Settled elsewhere, not reopened here:** the schema lives in `packages/plugin-sdk` (Q1)

v1 file citations are relative to `ultrasonics/official_plugins/` unless they start with
`ultrasonics/`. External facts cite the owning source. Where I could not reach a source, I say so.

## 1. Summary

The evidence supports keeping v1's outline and tightening its values:

- **A list of Playlists stays the right top level.** ADR-0020 refers to playlists by position and
  ADR-0021 parses each playlist and song separately. Both assume this shape, and no alternative
  pays its way.
- **Services agree on less than v1 assumed.** Title, an artist name and an album name are
  everywhere. ISRC is reliable only on the four big streaming catalogues: Spotify, Deezer, Apple
  catalogue and Tidal. ytmusicapi, Plex, Jellyfin, Last.fm and ListenBrainz do not give one.
  Duration is available from every source, but in five different units.
- **Dates come at mixed precision by design.** Spotify, Apple, ID3, MusicBrainz and beets all
  allow year-only dates. The format should say so rather than pretend every date is a day.
- **Identifiers need two fixes.** Values must be strings, because v1 Deezer mixed in ints. And
  the key must identify a namespace, not just a service: two Plex servers reuse the same
  `ratingKey`s, and v1 would score them as the same song.
- **Empty values are the commonest failure in practice.** Services return `null`, `""`, empty
  elements or nothing at all for missing data. v1's #38 and #42/#46 came from this. Because of
  ADR-0021's drop-the-song rule, the schema has to say what "missing" looks like, or harmless
  blanks will drop songs.
- **Two fields have earned a place:** a duration, and a playlist description. Explicit, album
  artists and cover art are judgement calls. Track/disc number and genre are not worth carrying.

## 2. Per-service capability table

On **read**, the table shows each field where the service exposes it. `—` means not exposed. ✓
means present. "lookup" means it is on a per-track request but not on the playlist-items one.

On **write**, every service adds songs to a playlist by its own ID. No playlist write accepts
song metadata, so for songs, "write" means only what an output can search by. The last two
columns are playlist fields, as read / write.

| Service | Title | Artists | Album | Album artists | Date (precision) | ISRC | Duration | Track/disc | Explicit | MBIDs | Pl. description R/W | Pl. cover R/W |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Spotify | `name` | `[{id,name}]` | ✓ (may be `""`) | ✓ | album `release_date` + `release_date_precision` year/month/day | `external_ids.isrc`; search `isrc:` | ms | ✓ | ✓ bool | — | ✓ / ✓ | ✓ (URLs expire) / ✓ JPEG ≤256 KB |
| Deezer¹ | `title` (+`title_version`) | `artist` + `contributors[{id,name,role}]` (lookup) | ✓ | — on track | track `release_date` (day, lookup); differs from album's | ✓; `/track/isrc:` returns one | s | lookup | ✓ bool | — | ✓ / unverified | ✓ / unverified |
| Apple Music | `name` | `artistName` string + IDs relationship | ✓ | — | `releaseDate` "YYYY-MM-DD or YYYY" | catalogue only, optional; `filter[isrc]` may return several | ms | ✓ | `contentRating` | — | ✓ / ✓ (create) | ✓ / — found |
| Tidal | `title` + `version` | relationship | relationship | — | album `releaseDate` only | required but nullable; `filter[isrc]` may return several | ISO 8601 (`PT2M58S`) | album-items meta only | ✓ bool | — | ✓ / ✓ | relationship / ✓ via artworks |
| YouTube Music (ytmusicapi) | `title` | `[{name,id}]` | `{name,id}` or `None` | — | `year` string | — | `duration_seconds` | `get_album` only | `isExplicit` | — | ✓ / ✓ | thumbnails / — |
| Plex (plexapi) | `title` | one string (`originalTitle` / `grandparentTitle`) | `parentTitle` | `grandparentTitle` | track `year` int; album `originallyAvailableAt` day | — | ms | `index` / `parentIndex` | — | `guids[]` (format unverified) | `summary` / ✓ `editSummary` | ✓ / ✓ `uploadPoster` |
| Jellyfin | `Name` | `Artists[]` + `ArtistItems[{Id,Name}]` | ✓ | `AlbumArtists[]` | `PremiereDate` datetime, `ProductionYear` | — | `RunTimeTicks` (100 ns, unverified) | `IndexNumber` / `ParentIndexNumber` | — | `ProviderIds.MusicBrainzRecording` / `…Track` | `Overview` / inferred | ✓ / ✓ |
| OpenSubsonic | `title` | `artist` string; OS `artists[]` + `displayArtist` | ✓ | OS `albumArtists[]` | song `year` int; album `releaseDate` `{year,month,day}` | OS `isrc: string[]` | s | `track` / `discNumber` | OS `explicitStatus` | `musicBrainzId` ("track MBID", ambiguous) | `comment` / ✓ | `coverArt` / — |
| Last.fm | `name` | one `artist` | `track.getInfo` only | — | — | — | ms | album `position` | — | `mbid` (often empty) | no playlists | no playlists |
| ListenBrainz (JSPF) | `title` | `creator` credit string + MB artist URIs | ✓ | — | — | — | ms | `trackNum` | — | recording URI in `identifier` | `annotation` / ✓ | — / — |
| Local tags (ID3v2.4 / Vorbis) | TIT2 / TITLE | TPE1 multi-value / repeated ARTIST | TALB | TPE2 / ALBUMARTIST | TDRC `yyyy[-MM[-dd…]]`; TDOR original | TSRC / ISRC | TLEN ms (often absent) | TRCK `n/total` | — | Picard UFID / MUSICBRAINZ_TRACKID (= recording) | n/a | n/a |

¹ developers.deezer.com now requires a login, so the Deezer read column comes from live responses
from `api.deezer.com`. That is the service itself, but it is observed behaviour, not documented
contract. I could not verify Deezer's write endpoints.

## 3. The questions

### Q2 — Top-level shape

**Evidence.**

- *Inputs return many playlists.* The v1 Spotify and Deezer inputs emit one Playlist per service
  playlist. Songs-mode inputs (Last.fm, Spotify saved songs) emit exactly one, with `id: {}`
  (`up_lastfm.py:241-243`, `up_spotify.py:604-609`). v1 concatenates the inputs, with no merge
  (`ultrasonics/plugins.py:270-274`).
- *Modifiers work per playlist.* The merger groups by exact `name` and unions the `id` maps
  (`up_playlist merger.py:77-129`). Name filters run `re.match` on `name`
  (`ultrasonics/tools/name_filter.py:53`).
- *Outputs write per playlist.* They find their target by `id.<service>` and fall back to `name`
  (Spotify, Deezer: `up_spotify.py:646-657`), or by name only (Plex beta, local playlists).
- *v2 already depends on the shape.* ADR-0020 §2 identifies a playlist by its position in
  `ctx.songs` and a song by its position in `songs`. ADR-0021 §3 drops a failing song from its
  playlist, drops a failing playlist with its songs, and treats a return that is "not a list" as
  a throw.

**Options.**

| Option | For | Against |
|---|---|---|
| **`Playlist[]` (v1)** | Matches every component's semantics. ADR-0020/0021 are written against it. Songs-mode inputs fit as one playlist. | Songs repeated across playlists are copied, which is negligible: ADR-0021 measured 25 ms for 50,000 songs. |
| `{ playlists: Playlist[] }` wrapper | Leaves room for top-level metadata (a format version, run provenance). | ADR-0021 §3's "not a list" rule would need amending. A new top-level field would be an ADR-level change anyway, so the wrapper buys little. |
| One playlist per run | Simpler outputs. | Breaks every multi-playlist applet, and v1's main use is "sync all my playlists". |
| Flat `Song[]` | Simplest for songs-mode inputs. | Loses the playlist boundaries that every output writes by. |
| Normalised (song table plus playlists of references) | Dedupes; a song's ids would be enriched once. | ADR-0021 drops songs individually and ADR-0020 reports them by position, and both get harder. Every modifier has to maintain referential integrity. Nothing in the evidence needs it. |

**Recommendation:** keep a bare **`Playlist[]`**. It rests on ADR-0020 §2, ADR-0021 §3 and the
v1 component behaviour cited above. The wrapper is the only real alternative, and it is a
judgement call. The evidence gives no present need for top-level metadata.

### Q3 — Playlist fields

**Evidence** (see the table for citations by service):

- *Name.* Every service has one on read and accepts one on write. The fields are Spotify `name`,
  Deezer `title`, Apple `name`, Tidal `name`, ytmusicapi `title`, Plex `title`, Jellyfin `Name`,
  Subsonic `name` and JSPF `title`.
  - Limits differ. Tidal accepts up to 250 characters on create. ytmusicapi rejects `<` and `>`.
  - v1 #17 shows `/` in a name breaking a file path. Making names safe for each target is the
    output's job.
- *Description.* Readable on every service except Last.fm.
  - Writable on Spotify, Apple (create), Tidal, ytmusicapi (HTML stripped), OpenSubsonic
    (`comment`), Plex (`editSummary`) and ListenBrainz (`annotation`).
  - Jellyfin: probably through `POST /Items/{id}`. That is an inference, not verified.
  - v1 never carried it, and hard-coded a description on create (`up_spotify.py:669`,
    `up_deezer.py:436`).
- *Cover art.* v1 #52 asks for Spotify's cover carried to Plex. The triage doc marks it Phase 3
  and ADR-level.
  - Readable on Spotify, Deezer, Apple, Plex, Jellyfin, ytmusicapi and Subsonic.
  - Writable on Spotify (base64 JPEG of 256 KB or less, with the `ugc-image-upload` scope), Tidal
    (`POST /artworks`, then the `coverArt` relationship), Plex (`uploadPoster`) and Jellyfin
    (`/Items/{id}/Images`).
  - Not writable through ytmusicapi, OpenSubsonic, or the Apple endpoints I could find.
  - Spotify's image URLs expire in under a day.
- *Owner, visibility, collaborative.* The models disagree:
  - Spotify: `public` (nullable) plus `collaborative`, which must be paired with `public:false`.
  - Tidal: `accessType` of PUBLIC, UNLISTED or PRIVATE, where create accepts only PUBLIC or
    UNLISTED.
  - ytmusicapi: `privacy` of PUBLIC, PRIVATE or UNLISTED.
  - Jellyfin: `IsPublic`. Subsonic: `public`. ListenBrainz: an extension `public`.
  - Plex: no visibility at all.
- *Folders.* A PR #45 user asked for Spotify's folder structure to be kept (triage doc). I found no
  folder field in the Spotify Web API playlist object. That is thin evidence: I did not search for
  one specifically.

**Options and recommendation.**

- **`name`**: required, non-empty string. Must-still-work #4 and #59 make it the most-used field.
- **`id`**: an open map (see Q4).
- **`songs`**: `Song[]`, which may be empty. Must-still-work #1 says an empty playlist is a skip,
  not a failure.
- **`description`**: optional string. **Recommend adding.** Ten of eleven sources read it, seven
  or eight accept it on write, and v1's hard-coded descriptions show outputs want to write one.
- **Cover art**: **a judgement call. I lean to deferring it to #52 (Phase 3).**
  - For an optional `image` URL: it is cheap, and every input that reads covers has a URL.
  - Against: Spotify's URLs expire. Writing needs bytes, and Spotify requires a JPEG of 256 KB or
    less, so every output fetches and re-encodes. Four of the services cannot write it at all.
  - Adding an optional field later costs one ADR, and the field would be designed with #52's
    actual consumer in hand.
- **Owner, visibility, collaborative**: **leave them out.** No two services share a model (see
  above), so a common field would have to be lossy. Visibility on write is output instance
  settings, as v1's hard-coded behaviour already is.

### Q4 — Song identity

**Evidence.**

- *Key naming in v1.* The key is the service name: `spotify`, `deezer`, `lastfm` and `plex`
  (`up_spotify.py:446`, `up_deezer.py:339-368`, `up_lastfm.py:151-153`, `up_plex beta.py:79`).
  Two plugins for one service would share a key. Spotify mixer reuses `spotify`. Legacy Plex
  writes no id, so it never conflicts with Plex beta.
- *Value types and meanings drift.* v1 Deezer stores playlist ids as ints but track ids as strings
  (`up_deezer.py:385`). `fuzzymatch` calls `.strip()` on id values, so an int would crash it. v1
  Last.fm stores a track **URL** as its "id" (`up_lastfm.py:151-153`).
- *Some ids are local to one server.* Plex `ratingKey` / `key` (`/library/metadata/N`), the
  Jellyfin `Id` and the Subsonic `id` each belong to one server. In v1, any shared id key scores
  100 (`ultrasonics/tools/fuzzymatch.py:136-150`). Two Plex servers that reuse `ratingKey` 123
  would therefore match unrelated songs. This is inferred from the code: no issue reports it.
- *One service can have several id spaces.*
  - Apple has catalogue `songs` and `library-songs`. Library songs carry no ISRC.
  - ytmusicapi has `videoId`, the track, and `setVideoId`, "the unique id of this playlist item".
  - Spotify has base-62 IDs and URIs (`spotify:track:…`). A local file has the pseudo-URI
    `spotify:local:{artist}:{album}:{title}:{seconds}` and no ID.
- *MusicBrainz is the one cross-service id.* Several sources expose the recording MBID: Jellyfin
  `ProviderIds.MusicBrainzRecording`, ListenBrainz `identifier`, Last.fm `mbid` (often empty), and
  local tags. Picard writes the **recording** MBID to UFID / `MUSICBRAINZ_TRACKID`, despite the
  name. OpenSubsonic's `musicBrainzId` is described as a "track MBID", which is ambiguous. None of
  the four streaming catalogues expose MBIDs.

**Options.**

| Option | For | Against |
|---|---|---|
| **Open map `Record<key, string>`** | Third-party plugins can add services without an SDK change (ADR-0004). The merger unions maps, as v1 did. | Nothing stops two plugins choosing different keys for one service, so a naming rule is needed. |
| Fixed service enum | Typos caught at compile time. | Every new plugin becomes an SDK (ADR-level) change. Cannot express per-server namespaces. |
| URIs (`spotify:track:…`) as values | Self-describing. | Only Spotify has a URI scheme. Every other service would need one invented for it. |
| MBID as its own top-level field | Signals it is cross-service. | It is just another id. Putting it in the map gets hard-key treatment for free. |

**Recommendation:** an **open map of non-empty string values**, with three rules:

- **The key names an id namespace, not a plugin.** For a global catalogue, that is the service
  (`spotify`, `deezer`, `apple`, `tidal`, `youtube`). For a self-hosted server, the plugin
  qualifies the key with the server's identity, for example `plex:<server id>`.
  - Evidence: Plex, Jellyfin and Subsonic ids are local to one server, and v1 treats any shared
    key as a hard match.
  - How to derive the server id is the plugin's business. I did not verify Plex's identifier
    field.
- **The value is the service's bare track id.**
  - Not a URI, not a URL, and not a playlist-item id: no Last.fm URL, and no `setVideoId`.
  - Apple: use the catalogue id where one exists. Library-only songs need their own key
    (`apple-library`).
  - Spotify local files get no `spotify` id.
- **`id.musicbrainz` is the recording MBID.**
  - This is the documented meaning wherever the source's own field is unambiguous: Jellyfin,
    ListenBrainz, and Picard tags.
  - The key **name** is a judgement call. Key syntax could be `^[a-z0-9-]+(:[^\s]+)?$`.
  - The same map, with the same rules, serves `Playlist.id`.

### Q5 — Artists

**Evidence.**

- Six sources give an array: Spotify `artists[{id,name}]`, Deezer `contributors[{id,name,role}]`,
  ytmusicapi `[{name,id}]`, Jellyfin `Artists[]` (plus `ArtistItems`), OpenSubsonic `artists[]`
  (plus `displayArtist`), and ID3v2.4 / Vorbis multi-value fields.
- Five give a single credit string: Apple `artistName` (IDs only through a relationship), Plex
  `originalTitle` / `grandparentTitle`, Last.fm `artist`, the JSPF `creator`, and ID3v2.3-era
  files.
- MusicBrainz models the credit as `[{artist, name, joinphrase}]`. The display string is each
  credited name plus its join phrase (musicbrainz.org/doc/Artist_Credits).
- v1 builds a list of names (`up_spotify.py:419`). Last.fm, Plex beta and custom file collapse to
  one name (`up_lastfm.py:146-150`, `up_plex beta.py:78`, `up_custom file.py:43-57`). Plex beta
  probably emits the *album* artist, which is an inference.
- v1 strips "feat."/"prod." from titles only when building a search query (`up_spotify.py:209-270`).
  It does not do so in the song dict.
- Artist ids would help only to search within that same service. Outputs search by name. The one
  cross-service artist id is the MBID, which only Jellyfin, OpenSubsonic, ListenBrainz and Picard
  tags expose.

**Options.**

- **`artists: string[]` (v1).** Simple, and covers every source.
  - A credit-string source emits one element and must **not** split it. Splitting "Simon &
    Garfunkel" or "Earth, Wind & Fire" on `&` or `,` is wrong, and only MusicBrainz knows the
    real join phrases.
  - The matcher has to compare `["Flume", "Kai"]` with `["Flume & Kai"]`. That is a matcher
    concern (ADR-0022), not a shape concern.
- **`artists: {name, ids?}[]`.** Keeps the per-service artist ids.
  - Nothing that writes a playlist needs them.
  - It doubles the shape for 11 sources so that 3 can carry MBIDs.
- **`artists` plus `artistCredit` (a display string).** Lossless for MusicBrainz-style data.
  - Two fields can disagree.
  - It helps only the matcher, which can join the array itself.

**Recommendation:** **`artists: string[]`, names as the source gives them, unsplit, with "feat."
left in titles.** It rests on the 6-array / 5-string split above and MusicBrainz's join-phrase
model. Structured artists are a judgement call, deferrable without harm, because nothing in the
evidence consumes artist ids today. Whether the array may be empty is in Q9.

### Q6 — Date

**Evidence.**

- *Precision varies, by design.*
  - Spotify: `release_date` with `release_date_precision` of `year`, `month` or `day`.
  - Apple: `releaseDate` is "YYYY-MM-DD or YYYY", and can be in the future for pre-releases.
  - Deezer: a full date.
  - Tidal: an ISO date on the album only.
  - Jellyfin: `PremiereDate` (a datetime) and `ProductionYear`.
  - Subsonic: `year` (an int). OpenSubsonic has a `{year, month, day}` ItemDate on the *album*.
  - Plex: track `year`, album `originallyAvailableAt`.
  - ytmusicapi: a `year` string.
  - ID3v2.4 TDRC: `yyyy`, `yyyy-MM`, `yyyy-MM-dd`, and finer.
  - MusicBrainz: partial dates in the release editor. beets: separate `year`, `month` and `day`.
  - Last.fm and ListenBrainz: no date.
- *Which date it is varies.*
  - Most services give the date of the *release* this copy is on.
  - Deezer's track `release_date` differs from its album's (2001-03-12 against 2001-03-07,
    observed).
  - An original date is separate where it exists: ID3 TDOR, Vorbis ORIGINALDATE, MusicBrainz
    `first-release-date`, OpenSubsonic `originalReleaseDate` (album), beets `original_year`. No
    streaming catalogue exposes one.
- *v1 passes raw strings* (`up_spotify.py:427`, `ultrasonics/sample-songlist.json` has "2018").
  Its matcher's `token_set_ratio` scores "2018" against "2018-05-27" as 100
  (`ultrasonics/tools/fuzzymatch.py:188`), which hides the precision problem rather than solving
  it.

**Options.**

| Option | For | Against |
|---|---|---|
| Free string (v1) | No plugin work. | "05/27/2016", datetimes and "2016" all compare badly. |
| **Partial ISO 8601 `YYYY`, `YYYY-MM` or `YYYY-MM-DD`** | Matches what Spotify, Apple, ID3 and MusicBrainz produce. Lexically sortable. JSON:API recommends ISO 8601. | Plugins must truncate datetimes (Jellyfin) and format ints (Plex, Subsonic). |
| Year-only `number` | Most sources can give it. | Discards the month and day that Spotify, Apple, Deezer and tags have. |
| `{year, month?, day?}` object | No parsing (OpenSubsonic, beets). | More verbose, and nothing downstream needs the parts separately. |

**Recommendation:** **`date`: a partial ISO string matching `^\d{4}(-\d{2}(-\d{2})?)?$`, the
release date of the copy described.** It rests on the precision evidence above. An
`originalDate` is a **judgement call. I lean to leaving it out**: no streaming source supplies
one, so the matcher can rarely use it. The matcher must treat a year and a full date in that year
as agreeing.

### Q7 — ISRC

**Evidence.**

- *Format* (ISRC Handbook, 4th edition, §3.3 and §5):
  - 12 characters of `A–Z` and `0–9`: a 2-letter country code, a 3-character alphanumeric
    registrant code, a 2-digit year of reference and a 5-digit designation.
  - Lower case is "not strictly permitted", and systems should upper-case input before
    validating it.
  - The display form `ISRC AA-6Q7-20-00047` is not the code. "The letters 'ISRC', the space and
    the hyphens do not form part of the ISRC".
  - MusicBrainz agrees: 12 uppercase `[A-Z0-9]` characters, no hyphens.
- *Identity rules* (Handbook §4.1, Appendix A):
  - Each recording has one ISRC, and an ISRC is never reassigned.
  - A compilation, a hi-res version or another business model keeps the ISRC.
  - Edits and remixes get a new one. A remaster gets a new one only if it involved creative
    input.
  - In practice a recording can end up with several ISRCs, in which case the registrant should
    pick a preferred one (A.13.2).
- *Availability* (see the table):
  - Present on Spotify and Deezer playlist items.
  - Optional on Apple catalogue songs, and absent on Apple library songs.
  - Required but nullable on Tidal.
  - An array on OpenSubsonic, and in MusicBrainz's `isrcs`.
  - Absent from ytmusicapi, Plex, Jellyfin, Last.fm and ListenBrainz.
  - Present in TSRC / ISRC tags. v1 never read it from m4a files
    (`ultrasonics/tools/local_tags.py:105`).
- *Lookup.* Spotify `q=isrc:` (up to 10 results), Deezer `/track/isrc:` (returns one track),
  Apple `filter[isrc]` ("one ISRC value may return more than one song") and Tidal `filter[isrc]`
  (may return several).
- *v1 handling.* It compares stripped and lower-cased values (`ultrasonics/tools/fuzzymatch.py:155-160`).
  A *differing* ISRC scores 0 at weight 10, which caps similarity near 65, below the default
  threshold of 90. A remastered or regional duplicate can therefore never match. That is a v1
  matcher bug, and the Handbook's own rules say differing ISRCs are not proof of different
  recordings.

**Options.**

- **Single `isrc` string.** Every write-side lookup takes one, and 7 of 9 sources give one.
- **`isrcs: string[]`.** Truthful for OpenSubsonic, MusicBrainz and multi-value tags. But every
  consumer handles a list for what is almost always one value.

**Recommendation:**

- **A single optional `isrc`, stored in canonical form, validated as
  `^[A-Z]{2}[A-Z0-9]{3}\d{7}$`.**
- The SDK exports a `normaliseIsrc()` that upper-cases, removes hyphens, spaces and a leading
  `ISRC`, and returns `undefined` when the result is invalid.
- An invalid ISRC must cost the song only its ISRC, not the song itself. Under ADR-0021 §3, a
  failing field drops the whole song, so the plugin has to normalise before it returns.
- Sources with several ISRCs emit the first. The array form is a **judgement call**: the Handbook
  and OpenSubsonic support it, but only two of eleven sources would use it.
- For the matcher's spec: a mismatched ISRC is weak evidence, not a veto.

### Q8 — New song fields

| Field | Availability (table) | Matters for matching? | Matters for writing? | Recommendation |
|---|---|---|---|---|
| **Duration** | Every source (Spotify ms, Deezer s, Apple ms, Tidal ISO 8601, ytmusicapi s, Plex ms, Jellyfin ticks, Subsonic s, Last.fm ms, JSPF ms, ID3 TLEN ms) | Yes. It separates radio edits from extended mixes. Soundiiz names duration as a matching signal (blog, not a spec). | No | **Add, as `durationMs` (integer).** The unit belongs in the key because sources use five. Plex beta already emits it (`up_plex beta.py:81`), and ADR-0021 notes it is currently stripped. |
| **Explicit** | Spotify, Deezer, Apple (`contentRating`, where absence means unknown), Tidal, ytmusicapi, OpenSubsonic; not Plex, Jellyfin, Last.fm or tags | Yes. Clean and explicit versions look alike, and the flag tells them apart. | Choosing the right search result | **Judgement call. Lean add, as an optional boolean**, where absent means unknown. |
| **Album artists** | Spotify, Jellyfin, OpenSubsonic, Plex, ID3 TPE2; not on Deezer, Apple or Tidal tracks | Somewhat: compilations ("Various Artists") | Searching local libraries | **Judgement call. Lean defer.** The big catalogues don't put it on the track. |
| MusicBrainz recording ID | Jellyfin, ListenBrainz, Last.fm (sparse), tags | A hard key | ListenBrainz output | **In `id.musicbrainz`** (Q4). No new field. |
| Release / album MBID | Tags, ListenBrainz `release_identifier` | Barely | No | Leave out. |
| Track / disc number | Most sources, but often only via a lookup (Deezer, Tidal, ytmusicapi) | Little: a playlist is not an album | No playlist write takes it | Leave out. v1 already discards it (`up_spotify.py:355`). |
| Genre | Album-level at best; Spotify's artist `genres` is deprecated | No | No | Leave out. |
| UPC | Album-level only | No | No | Leave out. |

No v1 issue asks for any of these fields (the v1 issue audit). The duration and explicit cases
rest on the matcher's needs, not on user requests.

### Q9 — Required fields, empty values and nulls

**Evidence: what "missing" looks like.**

| Source | Missing value looks like |
|---|---|
| Spotify | A local file has "a number of fields … empty, zero, false or null". Album name `""` after a takedown. Playlist items may be episodes. A null `item` happens in practice (v1 #42/#46) but is not documented. |
| Apple | Optional attributes are absent: `isrc`, `releaseDate`, `albumName` on library songs. |
| Tidal | `isrc` is required but nullable. |
| Jellyfin | Every field is nullable. |
| OpenSubsonic | A supported field "must return it with an empty / default value". `explicitStatus` can be `""`. |
| Plex | Absent attributes. |
| Last.fm | An empty element (`<mbid />`) or `""`. |
| ListenBrainz | Keys omitted. |
| Tags | No tag at all, in untagged files. |

v1 strips every falsy value (`up_spotify.py:449-450`), so a blank Spotify name became a song with
*no* `title`. That crashed the Plex output (#38). ADR-0021 left "whether `title` must be non-empty"
to this design.

**Options for optional fields:**

1. Reject `null` and `""`. Under ADR-0021, the whole song is then dropped for a blank album.
2. Accept `null`. Every consumer then handles three states.
3. **Treat `null` and `""` as absent.** Zod preprocesses them to `undefined`. The runner warns once
   per plugin, as ADR-0021 §2 already does for unknown keys.

**Recommendation:**

- **`title`**: required, trimmed, non-empty. This rests on #38 and must-still-work #4. A local
  plugin falls back to the file name when there is no title tag. That is a convention, not a
  primary source.
- **`artists`**: required, but the array **may be empty**. Each element is non-empty and trimmed.
  - Untagged local files and some Spotify local files have no artist.
  - Dropping them would lose songs that `location` can still match exactly.
  - Requiring at least one artist is the alternative. That is a **judgement call**, and it trades
    lost local files for a guarantee the matcher can lean on.
- **Optional fields**: absent means unknown. On input, `null` and `""` are normalised to absent,
  with a warning: option 3, by analogy with ADR-0021 §2.
  - Format failures (ISRC, date) are fixed by the SDK's normaliser helpers inside the plugin, not
    by the runner.
  - This does not move sanitising off the plugin (ADR-0021 §4). It stops a harmless blank costing
    a song.

### Q10 — Local file location

**Evidence.**

- *v1 stores whatever path the plugin had.* Local plugins rewrite between a Plex-side and an
  ultrasonics-side root with `str.replace`, which replaces anywhere in the path, not just the
  prefix. They also swap `\` and `/` when the two styles differ (`up_local playlists.py:103-133,
  198-205, 270-274`).
  - #22: a Windows-format m3u sent to Plex on Linux returns a 500.
  - The custom-file output would raise on a `\` in a path, because it passes the value to
    `re.sub` (`up_custom file.py:57`, inferred).
- *Server APIs return the server's view of the path.*
  - Plex: `media[].parts[].file`, an absolute on-disk path.
  - Jellyfin: `Path`.
  - Subsonic: `path` is documented as a "full path", but the docs' example is relative to the
    library, so it depends on the server.
- *Playlist formats use URIs.*
  - XSPF `location` "MUST be a legal URI", and relative URIs resolve against the playlist. JSPF
    copies this.
  - M3U lines may be absolute paths, relative paths or URLs. RFC 8216 defines only HLS, and
    there is no primary spec for local extended M3U.
- *file URIs.*
  - RFC 8089 writes drive paths as `file:///c:/path`, UNC paths as `file://host/share`, and
    non-ASCII characters as UTF-8 percent-encoding.
  - Node's `pathToFileURL` and `fileURLToPath` convert both ways, with an explicit `windows`
    option. Bun's behaviour is unverified.

**Options.**

| Option | For | Against |
|---|---|---|
| Absolute path string (v1) | Readable. What every API returns. | `C:\Music\a.mp3` and `/music/a.mp3` cannot be told apart reliably (#22). Equality is per-OS. |
| **`file://` URI** | Unambiguous across OSes (RFC 8089). Maps straight onto XSPF/JSPF. Node has converters. | Each local plugin converts on the way in and out. Comparison needs one canonical encoding, so the SDK should produce it. Less readable in logs. |
| Under `id.local` | Reuses hard-key handling. | A path is not an identity: files move, and two machines have two namespaces. An `id` key would also lose the "this is a file I can open" meaning that local outputs rely on. |
| Library-relative path plus a root setting | Portable between containers. | Every source must know its library root. Subsonic already gives relative paths, inconsistently. |

**Recommendation:**

- **Keep `location` as its own optional field, holding an absolute `file:` URI built by an SDK
  helper (`pathToFileURL`).** It rests on #22, RFC 8089 and XSPF.
- Translation between namespaces (the Plex server against the ultrasonics container) stays in
  plugin instance settings. A URI does not remove the need for it; it only makes the path
  unambiguous while translating.
- This is the weakest-evidenced recommendation. A plain absolute path is defensible if the
  readability of logs and the not-found file matters more than Windows parity.
- Either way, `location` is a hard key only within one filesystem namespace.

### Q11 — Field naming

**Evidence.**

- *Style guides.*
  - Google JSON Style Guide: "Property names must be camel-cased". I saw this through a search
    snippet, because a direct fetch returned 404.
  - JSON:API: member names "SHOULD be camel-cased".
  - Google TypeScript Style Guide: lowerCamelCase properties.
  - Zod's examples use camelCase (`confirmPassword`) but give no naming rule.
- *Services.*
  - camelCase: Apple, Tidal, OpenSubsonic, plexapi and ytmusicapi (mostly: `videoId`,
    `isExplicit`, though `duration_seconds` is snake_case).
  - snake_case: Spotify, Deezer and the ListenBrainz extensions.
  - PascalCase: Jellyfin.
  - kebab-case: MusicBrainz (`artist-credit`).
- *This repo.* v2 settings already use camelCase (`fuzzyRatio`, in the triage doc).

**Options.**

- **camelCase.** The documented norm for JSON and TypeScript, and the majority among services.
- **snake_case.** Matches Spotify and Deezer, but goes against every style guide found.

The ecosystem has no common convention, so mapping is unavoidable whichever is chosen.

**Recommendation:** **camelCase.** It rests on the Google JSON/TS guides and JSON:API. It affects
only multi-word keys: `durationMs`, and any future `albumArtists` or `originalDate`.

## 4. The recommendations as a sketch

For orientation only. The design spec owns the real schema.

```ts
const IdMap = z.record(z.string().regex(/^[a-z0-9-]+(:\S+)?$/), z.string().min(1));

const Song = z.object({
  title: z.string().trim().min(1),
  artists: z.array(z.string().trim().min(1)),          // may be empty (Q9, judgement)
  album: z.string().trim().min(1).optional(),
  date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/).optional(),
  isrc: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/).optional(),
  durationMs: z.number().int().positive().optional(),
  explicit: z.boolean().optional(),                    // judgement
  location: z.string().startsWith("file:").optional(), // judgement
  id: IdMap.default({}),                               // `musicbrainz` = recording MBID
});

const Playlist = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  id: IdMap.default({}),
  songs: z.array(Song),
});

const SongDict = z.array(Playlist);
```

## 5. Where the evidence is thin

- **Deezer:** the docs are login-gated. The read side comes from live responses, and the write side
  is unverified.
- **Apple:** the library-ID format and the per-request add limit are unverified.
- **Plex:** the GUID/MBID format and the server-identity field are unverified.
- **Jellyfin:** the tick unit and description write are unverified.
- **Spotify:** the API does not document that `item` can be null. It happens in practice (#42/#46).
- **Soundiiz and TuneMyMusic:** they publish marketing pages only, and no field-level
  documentation.
- **Bun:** its `pathToFileURL` behaviour was not checked.
- **v1 #30:** could not be fetched (a TLS timeout), so I relied on the triage doc.

## 6. Sources

**Services**

- Spotify:
  - https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
  - https://developer.spotify.com/documentation/web-api/reference/get-playlist
  - https://developer.spotify.com/documentation/web-api/concepts/spotify-uris-ids
  - https://developer.spotify.com/documentation/web-api/concepts/playlists
  - https://developer.spotify.com/documentation/web-api/reference/search
  - https://developer.spotify.com/documentation/web-api/reference/create-playlist
  - https://developer.spotify.com/documentation/web-api/reference/change-playlist-details
  - https://developer.spotify.com/documentation/web-api/reference/add-items-to-playlist
  - https://developer.spotify.com/documentation/web-api/reference/upload-custom-playlist-cover
- Deezer (observed responses):
  - https://api.deezer.com/track/3135556
  - https://api.deezer.com/track/isrc:GBDUW0000059
  - https://api.deezer.com/playlist/908622995
  - https://api.deezer.com/album/302127
- Apple Music API, via its DocC JSON:
  - `https://developer.apple.com/tutorials/data/documentation/applemusicapi/…`: songs, librarysongs,
    playlists, libraryplaylists, get-multiple-catalog-songs-by-isrc,
    create-a-new-library-playlist, add-tracks-to-a-library-playlist
- Tidal:
  - https://tidal-music.github.io/tidal-api-reference/tidal-api-oas.json (v1.10.183)
- ytmusicapi:
  - https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/playlists.py
  - https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/parsers/playlists.py
  - https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/browsing.py
  - https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/search.py
- python-plexapi:
  - https://github.com/pkkid/python-plexapi/blob/master/plexapi/audio.py
  - https://github.com/pkkid/python-plexapi/blob/master/plexapi/playlist.py
  - https://github.com/pkkid/python-plexapi/blob/master/plexapi/media.py
- Jellyfin:
  - https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json (v12.2.0)
- OpenSubsonic:
  - https://github.com/opensubsonic/open-subsonic-api/tree/main/content/en/docs (Child.md,
    AlbumID3.md, itemDate.md, playlist.md, createplaylist.md, updateplaylist.md, search3.md)
- Last.fm:
  - https://www.last.fm/api/show/track.getInfo
  - https://www.last.fm/api/show/user.getLovedTracks
- ListenBrainz:
  - https://listenbrainz.readthedocs.io/en/latest/users/api/metadata.html
  - https://github.com/metabrainz/listenbrainz-server/blob/master/listenbrainz/webserver/views/playlist_api.py
  - https://github.com/metabrainz/listenbrainz-server/blob/master/listenbrainz/db/model/playlist.py

**Formats and standards**

- ISRC:
  - ISRC Handbook, 4th ed. (2021): https://isrc.ifpi.org/images/downloads/ISRC_Handbook.pdf
  - https://musicbrainz.org/doc/ISRC
- MusicBrainz:
  - https://musicbrainz.org/doc/Recording
  - https://musicbrainz.org/doc/Track
  - https://musicbrainz.org/doc/Release_Group
  - https://musicbrainz.org/doc/Artist_Credits
  - https://musicbrainz.org/doc/MusicBrainz_API
  - https://musicbrainz.org/doc/Development/Seeding/Release_Editor
  - https://musicbrainz.org/doc/jspf
- ID3v2.4:
  - https://id3.org/id3v2.4.0-frames
  - https://id3.org/id3v2.4.0-structure
- Vorbis comments: https://www.xiph.org/vorbis/doc/v-comment.html
- Picard tag mapping:
  https://picard-docs.musicbrainz.org/en/v3.0/appendices/tag_mapping.html
- mutagen:
  - https://mutagen.readthedocs.io/en/latest/user/id3.html
  - https://github.com/quodlibet/mutagen/blob/main/mutagen/easyid3.py
- beets:
  - https://beets.readthedocs.io/en/stable/reference/pathformat.html
  - https://github.com/beetbox/beets/blob/master/beets/library/models.py
- XSPF and JSPF:
  - https://xspf.org/spec
  - https://xspf.org/jspf
- RFCs:
  - RFC 8216 (HLS / M3U8): https://www.rfc-editor.org/rfc/rfc8216
  - RFC 8089 (file URI): https://www.rfc-editor.org/rfc/rfc8089
- Node `url`: https://nodejs.org/api/url.html
- Soundiiz and TuneMyMusic (marketing, not specs):
  - https://soundiiz.com/blog/transfer-music-data-from-one-service-to-another/
  - https://www.tunemymusic.com/features/transfer
- Naming conventions:
  - https://google.github.io/styleguide/jsoncstyleguide.html
  - https://jsonapi.org/recommendations/
  - https://google.github.io/styleguide/tsguide.html
  - https://zod.dev/api

**v1 and repo**

- `ultrasonics/official_plugins/*.py`, `ultrasonics/tools/fuzzymatch.py`,
  `ultrasonics/tools/local_tags.py`, `ultrasonics/tools/name_filter.py`, `ultrasonics/plugins.py`,
  `ultrasonics/sample-songlist.json`
- v1 issues #17, #22, #29, #30, #32, #36, #38, #42, #46, #49, #52, #56, #59 and PR #45:
  https://github.com/XDGFX/ultrasonics/issues
- `docs/reference/v1-issue-triage.md`, `docs/reference/legacy-architecture.md`, and ADR-0020, -0021
  and -0022
