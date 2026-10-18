# Spec — the v2 song dict

**Status:** ready-for-agent

**Sources:** ADR-0023 (the shape and why), ADR-0022 (design it fresh), ADR-0021 (how the runner
uses it), `docs/research/song-dict.md` (evidence). Nothing here re-decides those. Where this spec
adds a decision, it says so.

## Problem Statement

Every plugin reads and writes the song dict, and no plugin can be written until it exists. Phase 0's
exit gate needs the song-dict Zod schema and its tests merged. v1 had no schema, so its plugins sent
blanks, missing titles, Windows paths and dates in any format. One blank title crashed the Plex
output (v1 #38).

## Solution

A new package, `packages/plugin-sdk`, whose first public surface is the song dict:

- the `SongDict` Zod schema and its `Playlist` and `Song` parts;
- the input and output types inferred from it;
- a strict variant for the conformance check;
- four normaliser helpers that plugins use to clean service data before returning it.

Nothing else from the SDK (`definePlugin`, contexts, auth) is in scope.

## User Stories

1. As a plugin author, I return what a service sends, blanks included. The schema cleans it, so I
   don't hand-write blank checks.
2. As a plugin author, I get a typed, clean `SongDict` in `ctx.songs`, with no `null` and no empty
   strings to handle.
3. As a plugin author, I pass a raw ISRC, date or path through a helper. It either gives me the
   normalised value or tells me to leave the field out.
4. As the runner (Phase 1), I parse each playlist and song with the lenient schema. I warn when the
   strict schema would have failed.
5. As the conformance check (Phase 1), I fail an official plugin whose fixture output fails the
   strict schema.
6. As someone debugging a stored or logged dict, I can see which shape `version` it has.

## Implementation Decisions

### The package

- `packages/plugin-sdk`, named `@ultrasonics/plugin-sdk`. Its `exports` field is its public surface
  (ADR-0014): `"."` only, re-exporting everything below.
- `zod` 4.6.7 is a dependency of the package, pinned like the root's.
- Files are named for their concept (ADR-0014): `song-dict.ts`, `isrc.ts`, `release-date.ts`,
  `file-uri.ts`, each with a colocated `*.test.ts`.

### The schema

The TypeScript types are inferred from the schema, never declared beside it (`AGENTS.md`).

| Field | Rule |
|---|---|
| `SongDict.version` | The literal `1`. Optional on input, where it defaults to `1`. |
| `SongDict.playlists` | An array of `Playlist`. It may be empty. |
| `Playlist.name` | Required, trimmed, non-empty. |
| `Playlist.description` | Optional, trimmed. |
| `Playlist.id`, `Song.id` | A map from ID-space key to bare ID. The key matches `^[a-z0-9-]+(:\S+)?$`. The value is trimmed; a blank or `null` value drops that entry, as with any other blank (Last.fm sends empty MBIDs). Optional on input, where it defaults to `{}`. |
| `Playlist.songs` | An array of `Song`. It may be empty. |
| `Song.title` | Required, trimmed, non-empty. |
| `Song.artists` | Required array; it may be empty. Each name is trimmed and non-empty. |
| `Song.album` | Optional, trimmed. |
| `Song.date` | Optional. Matches `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, with a real month and day (no `2020-13` or `2021-02-30`). |
| `Song.isrc` | Optional. Matches `^[A-Z]{2}[A-Z0-9]{3}\d{7}$`. |
| `Song.durationMs` | Optional. A positive integer. |
| `Song.explicit` | Optional boolean. Absent means unknown. |
| `Song.location` | Optional. An absolute `file://` URI, which must parse as a URL with the `file:` protocol. |

**The lenient schema (`SongDict`)** has these rules:
- It trims every string.
- It turns `null`, or a string that is blank after trimming, in any optional field into absent.
- It strips unknown keys (ADR-0021 §2).
- Format rules (`date`, `isrc`, `location`, ID keys) are not repaired: a bad value fails the song.

**The strict schema (`StrictSongDict`)** is a decision added by this spec: a separate export, so the
runner and conformance check need no flag. It applies the same rules, but rejects instead of
repairing:
- a `null` or blank optional field;
- an unknown key at any level;
- an untrimmed string.

`version` and `id` defaults still apply.

**Exports:**
- the schemas `SongDict`, `Playlist`, `Song` and `StrictSongDict`;
- the types `SongDict`, `Playlist` and `Song` (`z.output`) and `SongDictInput`, `PlaylistInput` and
  `SongInput` (`z.input`).

`SongDictInput` must be a real object type. Optional string fields are typed as
`string | null | undefined`, not `unknown`. Zod 4's `z.preprocess` infers `unknown` as its input,
so it cannot carry the blank handling on its own.

### The helpers

Each helper returns the normalised value or `undefined` and never throws. Its result always passes
the schema's rule for that field.

- **`normaliseIsrc(raw: string): string | undefined`**
  - Trims, upper-cases, and strips hyphens and spaces.
  - Returns the result if it matches the ISRC rule, otherwise `undefined`.
- **`normaliseDate(raw: string | number | Date): string | undefined`**
  - A `Date` gives `YYYY-MM-DD` in UTC.
  - A number gives `YYYY` for an integer between 1000 and 9999.
  - A string may be `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, or an ISO date-time, which is cut to its date
    part.
  - Anything else, or an impossible date, gives `undefined`.
- **`toFileUri(path: string): string | undefined`**
  - Takes an absolute POSIX or Windows path (`C:\Music\a.flac`, or UNC `\\server\share\a.flac`).
  - Returns a percent-encoded `file://` URI. A relative path gives `undefined`.
- **`fromFileUri(uri: string): string | undefined`**
  - The inverse of `toFileUri`.
  - A Windows URI gives a Windows path, whatever platform the code runs on.
  - A non-`file:` URI gives `undefined`.

## Testing Decisions

- Tests are behaviour-level: they parse inputs and assert on the parsed output or the issue paths,
  never on Zod internals.
- Fixtures are in `packages/plugin-sdk/test/fixtures/`:
  - one realistic dict per service shape the research covers, with each service's blanks;
  - an untagged local file;
  - the cases behind v1 #22 (a Windows path) and v1 #38 (a blank title).
- A type-level test (`expectTypeOf`, or a `tsc`-checked assignment) checks two things:
  `SongDictInput` accepts `null` and `""` in optional fields, and `SongDict`'s optional fields
  exclude both.
- The `file://` round trip is tested with Windows paths on a POSIX runner, because CI is Ubuntu.
  The research did not verify how Bun's `url` module handles Windows paths. If `pathToFileURL`
  can't be forced to Windows semantics, the helper does its own conversion, and the test proves it.

## Acceptance criteria

- [ ] `@ultrasonics/plugin-sdk` exists, depends on `zod` 4.6.7, and exposes only `"."`.
- [ ] A dict with `null`, `""` and whitespace-only optional fields parses with those fields absent.
      The same dict fails `StrictSongDict`, with an issue path for each one.
- [ ] A song with a blank or missing `title` fails. A song with `artists: []` passes.
- [ ] Bad `date`, `isrc`, `location`, `durationMs` and ID-key values each fail the song, with the
      issue at that field's path.
- [ ] Unknown keys are stripped by `SongDict` and rejected by `StrictSongDict`, at every level.
- [ ] `version` and `id` default when absent, and `version: 2` fails.
- [ ] The type-level test passes, and no shipped type in the package is `any` or `unknown`.
- [ ] Every helper's output passes its field's rule (tested over its fixture cases), and every
      helper returns `undefined` for its invalid cases without throwing.
- [ ] `toFileUri` and `fromFileUri` round-trip POSIX, Windows-drive and UNC paths, including spaces
      and non-ASCII names.
- [ ] `bun run test` and `bun run check:ci` pass, locally and in CI.
- [ ] The roadmap's Phase 0 status records the song dict. A handoff and a session log are written.

## Out of Scope

- The runner's parse-per-song, its warnings and the `rejected` results entries (ADR-0021). These
  are Phase 1, in the runner's spec.
- `runConformance` (Phase 1).
- The rest of the plugin SDK surface (`definePlugin`, contexts, auth).
- The matcher and the match dataset (Phase 1, ADR-0022).
- Duration converters. Each plugin does its own arithmetic.

## Further Notes

- If Zod 4.6.7 can't express the lenient input type without `unknown`, stop and escalate. A wrong
  input type would weaken the SDK contract (`AGENTS.md` checkpoint).
- Changing any field or rule after this lands is an ADR-level decision (ADR-0023).
