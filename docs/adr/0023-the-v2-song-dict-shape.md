# ADR-0023 — The v2 song dict's shape

**Status:** Accepted
**Date:** 2026-10-18
**Builds on:** ADR-0022 (design the song dict fresh), ADR-0021 (the runner validates it)
**Amends:** ADR-0020 §2 and §4, where a playlist's position is now within `playlists`; ADR-0021 §3,
where a return that is not a song dict object fails as a whole, and its notes on `duration` and
`title`; `docs/proposals/plugin-sdk-v2.md`, whose `SongDict` return type becomes `SongDictInput`.
**Evidence:** [`docs/research/song-dict.md`](../research/song-dict.md)
**Spec:** [`docs/specs/song-dict/spec.md`](../specs/song-dict/spec.md)

## Context

ADR-0022 left the song dict's shape to a fresh design. Cal decided each question in a grilling
session on 2026-10-18, against the research above. This ADR records the choices that a reader
would not guess from the schema alone. The spec has the full field list.

## Decision

1. **A song dict is an object, not a bare list:** `{ version: 1, playlists: [Playlist] }`. Fields
   that apply to the whole run can then be added without a breaking change. `version` helps with
   debugging stored or logged dicts. On input it defaults to the current version.
2. **`id` keys name an ID space, not a plugin.** An ID that is only unique on one server carries
   the server in its key, such as `plex:<server id>`, because a shared ID counts as an exact match.
   Values are bare IDs, never URLs. `id.musicbrainz` is the recording MBID.
3. **Blanks are absent.** On input, every string is trimmed, and `null` or an empty string in an
   optional field becomes absent. Services send blanks routinely (research Q9), and under
   ADR-0021 §3 a rejected blank would cost the whole song. `title` must still be non-empty.
   `artists` is required but may be an empty list, so untagged local files survive.
4. **Two types.** Plugins return `SongDictInput`, the schema's input type, which admits blanks and
   a missing `version` or `id`. Plugins receive `SongDict`, its output type, which is clean.
5. **Formats are strict, and the SDK ships the normalisers.** `isrc` is the 12-character
   normalised form. `date` is a partial ISO date (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), the release
   date of that release. `location` is an absolute `file://` URI, which also covers Windows paths
   (v1 #22). `normaliseIsrc`, `normaliseDate`, `toFileUri` and `fromFileUri` return `undefined` for
   a value they cannot convert, so a plugin omits the field instead of losing the song.
6. **A strict variant rejects what the lenient schema repairs:** blanks and unknown keys. The
   runner can warn by checking it after the lenient parse succeeds, and ADR-0021 §7's conformance
   check fails on it.
7. **New fields are limited to `durationMs` and `explicit`.** `durationMs` is the strongest new
   matching signal. `explicit` separates clean and explicit versions, and absent means unknown.
   Track and disc numbers, album artists, genre, UPC and playlist cover art are left out. No
   playlist write uses them, or no two services agree on them.

## Considered options

- **A bare list (v1).** It fits ADR-0020 and ADR-0021 as written. But adding anything about the
  run later would change every plugin's signature.
- **Rejecting blanks.** This is cleaner in principle, but a blank album from Jellyfin would drop the
  song.
- **Local files under `id.local`.** A path changes when files move, so it is not an ID, and it
  needs its own format rules anyway.
- **Artist objects with IDs.** These add little, because a same-service match already has the
  song's own ID.
