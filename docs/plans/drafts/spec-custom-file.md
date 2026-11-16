# Draft spec: the custom file plugin

> Draft for grilling, not yet filed. Phase 2 (plugin parity). Points marked **⚑** touch the auth
> layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md, checkpoint
> gates). Where filesystem plugins may write is the local playlists draft's open question 1, and
> this draft assumes its recommendation.

## Problem Statement

Some users want a playlist as plain text: a list to read, paste into another tool, or keep as a
record. #29 ("Spotify to .txt file") is one. v1's `custom file` output wrote one line per song from a
pattern such as `{artist} - {title} (ISRC: {isrc})`, one file per playlist.

Its source shows these faults:

- It substituted with `re.sub`, so a title holding a backslash was read as a regex escape.
- An unknown placeholder, or a song with no `id` map, raised `KeyError` and failed the applet.
- The playlist name went into the filename unsanitised, so `AC/DC` created a folder, and a name with
  `:` failed on Windows (must-still-work #7).
- In append mode it joined the first new line onto the last old one, because it wrote no trailing
  newline.
- A filename without `{name}`, in overwrite mode, kept only the last playlist.
- It wrote whatever filename the user typed, so `dir=/config` and a filename of `ultrasonics.db`
  would overwrite v2's database.

## Solution

A new plugin, `custom-file`, with an `outputs` component in `playlists` mode and no auth. For each
playlist it renders one line per song from a pattern, and writes the lines as UTF-8 to a file in a
chosen folder, named from a filename pattern. It returns an `OutputResult`, where a song that a
pattern couldn't render counts as unmatched.

Placeholders are parsed when the settings are saved, so an unknown one is a form error, not a
crash. Substitution is plain string replacement.

## User Stories

1. As a user, I want each playlist written to a text file named after it, such as `{name}.txt`, so
   that I can read or share it.
2. As a user, I want one line per song from my own pattern, such as `{artist} - {title}`.
3. As a user, I want `{title}`, `{artist}` (the first artist), `{artists}` (all of them),
   `{album}`, `{date}`, `{isrc}`, `{location}` and `{id.<space>}` available, so that I can include
   the fields I need.
4. As a user, I want a typo in a placeholder caught when I save the form, so that a run never
   crashes on it.
5. As a user, I want literal braces written with `{{` and `}}`.
6. As a user, I want a song missing a field my pattern uses skipped and counted as unmatched, so that
   the run shows "wrote 48 of 50" (v1's documented behaviour, now visible: ADR-0020 §4).
7. As a user, I want titles with backslashes, quotes and non-ASCII characters written exactly.
8. As a user, I want playlist names sanitised into valid filenames, including the characters
   Windows forbids (must-still-work #7).
9. As a user, I want to choose whether each run overwrites the file or appends to it.
10. As a user appending, I want new lines to start on a new line, never joined onto the last one.
11. As a user whose filename pattern has no `{name}`, I want every playlist written into that one
    file in order, so that a "songs" list works.
12. As a user, I want an empty playlist skipped with a reason, not written as an empty file
    (must-still-work #1).
13. As a user, I want one playlist whose file can't be written reported as failed while the rest
    write (must-still-work #2).
14. As a user, I want a folder that doesn't exist to fail the run before anything is written.
15. As a user, I want an overwrite never to leave a half-written file.
16. As a v1 user, I want my custom file applets imported with the same patterns.
17. As a maintainer, I want the plugin to pass `runConformance`, tested against a temporary folder.

## Implementation Decisions

### Package and registration

- `packages/plugins/custom-file`, named `@ultrasonics/plugin-custom-file`, depending on
  `@ultrasonics/plugin-sdk` and `zod`.
- `definePlugin` with `name: "custom-file"`, `mode: ["playlists"]`, one `outputs` handler, **no
  `auth`**, **no `persistentSettings`** (so it isn't listed on the settings page, ADR-0019 §6) and
  **no `test()`**.
- v1 declared `mode: ["songs", "playlists"]`. The runner only warns when a plugin without
  `playlists` mode receives several playlists, and this plugin handles several, so `playlists` is
  enough. Story 11 gives the songs case its behaviour.

### Instance settings (`outputs`)

A flat object (ADR-0019 §3):

- `dir`: a non-empty absolute path.
- `fileName`: string, default `{name}.txt`. A `.refine()` requires that it holds no `/` or `\`,
  that its only placeholder is `{name}`, and that its extension is on the allowed list (below).
- `pattern`: string, default `{artist} - {title}`. A `.refine()` parses it and rejects unknown
  placeholders, naming them.
- `existing`: `overwrite` or `append`, default `overwrite`. A `warning` on `overwrite` says the file
  is replaced each run.

Refinements run on the server and show at form level (ADR-0019 §3), which is where these messages
belong.

### Rendering a line

- Placeholders: `{title}`, `{artist}` (first artist), `{artists}` (all, joined with `, `),
  `{album}`, `{date}`, `{isrc}`, `{location}` (the path from `fromFileUri`, else the URI as given),
  `{id.<space>}` for any ID space. `{{` and `}}` are literal braces.
- Substitution is a single pass of string concatenation over the parsed pattern. No regex touches
  the values.
- A song missing any field its pattern uses produces no line, and its position goes in
  `unmatched`. `{artist}` and `{artists}` count as missing when `artists` is empty.
- Line breaks inside a value (`\r`, `\n`) become spaces, so one song is always one line.

### Writing

1. Check `dir` exists and is a directory, or throw (ADR-0020 §3).
2. Group playlists by rendered filename. `{name}` becomes the sanitised playlist name, using the
   same rules as local playlists: remove `\ / : * ? " < > |` and control characters, trim trailing
   dots and spaces, prefix `_` to Windows reserved names. A name empty after sanitising is
   `skipped`, code `invalid-name`.
3. For each file, in order of first appearance:
   - **Overwrite:** render every playlist in the group, write to a temporary file in `dir`, rename
     it over the target.
   - **Append:** if the file exists and doesn't end in a newline, write one first. Then append.
   - Lines end in `\n`, and the file ends in `\n`. UTF-8, no BOM (must-still-work #7, #29).
4. Per playlist, by position:
   - no songs: `skipped`, code `empty`;
   - songs, but no line rendered: `skipped`, code `no-lines`, with a `warn`;
   - a write error for its file: `failed`, code `write-error`, for every playlist in that file;
   - otherwise `written`, with `unmatched`.
5. Return the `OutputResult` with each playlist once (ADR-0020 §2).

When two playlists share a file and one is empty, the empty one is `skipped` and the other is
written. A shared file in `overwrite` mode is written once per run, so story 11 works.

### File access ⚑ multi-tenancy

As in the local playlists draft, open question 1: self-host only, the container's mounts as the
boundary. Two guards are specific to this plugin, because it writes a file whose name the user
types:

- The written file is always directly inside `dir`. `fileName` can't hold a separator, and `{name}`
  is sanitised.
- The extension must be one of `.txt`, `.csv`, `.tsv`, `.m3u`, `.m3u8`, `.md` or `.log`. That keeps
  a mistyped setting from overwriting `ultrasonics.db`, a key file, or anything else in the data
  directory. Open question 1.

### v1 import mapping (ADR-0017 §5)

A module accepting `custom file` at any version (v1 shipped 0.1). v1 had no persistent settings.

- `dir` → `dir`.
- `existing_files` `Overwrite`/`Append` → `existing` `overwrite`/`append`.
- `playlist_name` → `fileName`. Same `{name}` syntax.
- `pattern` → `pattern`. v1's placeholders are a subset of v2's, with the same spelling.
- Values that break v2's rules (an extension not on the list, a `/` in the filename, an unknown
  placeholder that crashed v1 anyway) are imported as written. They fail the schema and show in the
  form (ADR-0019 §7). The report lists them.
- **Fixture test:** a v1 applet with each `existing_files` value, an `{id.spotify}` pattern, and one
  with a `.db` filename that fails the schema.

## Testing Decisions

- A good test drives the `outputs` handler with a harness context and a temporary `dir`, and
  asserts on the files written and the `OutputResult`.
- **`runConformance`** with settings fixtures (valid: defaults, a CSV pattern, `append`; invalid: an
  unknown placeholder, `../x.txt`, `notes.db`) and a temporary `dir`. The default song dict's empty
  playlist is `skipped` `empty`.
- **Cases:** every placeholder; `{{` and `}}`; a backslash and a curly quote written exactly; a song
  missing `isrc` in `unmatched`; `no-lines`; append after a file with no trailing newline; overwrite
  replaces; `fileName` without `{name}` collects every playlist in one file, in order; sanitised
  names; a read-only file fails its playlists while another file is written; a missing `dir`
  throws.

## Out of Scope

- The run's not-found file. ADR-0020 §7: "The host exports a run's unmatched songs. No plugin
  writes files." This plugin is a user's chosen output, not that export.
- Headers, footers, and per-playlist templates.
- Formats with structure, such as JSON or XSPF.
- Windows line endings. An option could be added later without breaking anything.

## Open questions

Each has a recommendation. ⚑ marks a checkpoint.

1. **The extension allowlist.** ⚑ multi-tenancy, in the self-host sense. This is the only guard
   between a typo and an overwritten database, because the plugin can't tell where the data
   directory is without an SDK change (the local playlists draft's open question 1).
   - **Recommended:** the list above. It covers every text use in the backlog, and the importer
     reports any v1 applet it blocks.
   - Alternatives:
     - No list; trust the user. Matches v1, and a single bad setting can destroy the install.
     - Refuse any `dir` that contains `ctx.configDir`. The plugin can see `configDir`, but the
       layout above it (`<DATA_DIR>/accounts/<id>/plugins/<name>`) is the server's, and inferring
       `DATA_DIR` from it would bake that layout into plugin code.
2. **New placeholders.** v1 had `{title} {artist} {album} {isrc} {location} {id.<service>}`.
   - **Recommended:** add `{artists}` and `{date}`. Both are song dict fields, and `{artists}` fixes
     the loss of every artist after the first.
   - Alternatives: v1's set only; or every song field, including `{durationMs}` and `{explicit}`,
     which need formatting rules nobody has asked for.
3. **Missing fields.** v1 skipped the song.
   - **Recommended:** keep skipping, and count it in `unmatched`. A line with a blank in it would
     read as data.
   - Alternative: render a missing field as empty. That would write a `-` line for a song with no
     artist, which is worse for the CSV case.

## Further Notes

- **Tickets: one.** Small output, one mapping.
- **Decided here, worth a glance:**
  - Unknown placeholders are a settings error, not a run error.
  - `fileName` without `{name}` collects all playlists into one file.
  - Appending repairs a missing trailing newline first.
  - "Unmatched" here means "not written because a field was missing". The glossary defines it as
    "no counterpart found on the service" (ADR-0020). This stretches the word slightly, and keeps
    the run's "wrote N of M" honest.
- **No change to the plugin SDK contract.**

## Planned tickets

1. **The custom file output.** Package, registration, settings with their refinements, rendering,
   writing, the v1 mapping and its fixture test.
   - [ ] Unknown placeholders, separators in `fileName` and disallowed extensions are rejected on
     save, naming the problem.
   - [ ] Every placeholder renders, values are written exactly, and braces escape.
   - [ ] Songs missing a field are listed in `unmatched`.
   - [ ] Append never joins lines, and overwrite is atomic.
   - [ ] A `fileName` without `{name}` writes all playlists to one file in order.
   - [ ] Each playlist appears once in the result.
   - [ ] `runConformance` passes.
   - [ ] The v1 fixture maps as specified, and a `.db` filename shows as a schema issue.
   - [ ] `/verify`: a Spotify playlist writes a `.txt` with non-ASCII titles intact.
