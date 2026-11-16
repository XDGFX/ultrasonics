# Draft spec: the log tracks plugin

> Draft for grilling, not yet filed. Phase 2 (plugin parity). Points marked **⚑** touch the auth
> layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md, checkpoint
> gates). Nothing in this spec does.

## Problem Statement

An applet needs at least one output (`AppletDefinition`'s `outputs: min(1)`). When a user is
building an applet, or checking what an input and its modifiers produce, they want to see the songs
without writing them anywhere. v1's `log tracks` did that: an output that printed the whole song
dict as indented JSON to the log.

v2 changes what "the log" is. A run's log is stored in its row and capped at 1 MB or 10,000 lines,
keeping the head and the tail (ADR-0009 §5). A 2,000-song playlist dumped as indented JSON is about
20 lines per song, so v1's approach would fill the cap with one playlist and push out the lines
that say what went wrong. The run view already shows each stage's song counts (ADR-0009 §5,
`stages`) and each output's result per playlist (ADR-0020 §7). What it doesn't show is the songs
themselves.

## Solution

A new plugin, `log-tracks`, with an `outputs` component in `playlists` mode, no settings and no
auth. For each playlist it logs one header line, then one line per song, up to a cap per run. It
returns every non-empty playlist as `written` with nothing unmatched, so the applet runs as a dry
run and ends `succeeded`.

## User Stories

1. As a user building an applet, I want an output that writes nothing and shows me the songs, so
   that I can check an input before pointing it at a real service.
2. As a user, I want each playlist's name and song count on its own line.
3. As a user, I want one readable line per song: artists, title, album, and the ids and location it
   carries, so that I can see what a matcher would get.
4. As a user, I want the song lines capped, so that a large playlist never pushes the run's errors
   out of the log.
5. As a user, I want to be told how many lines the cap left out.
6. As a user, I want an empty playlist reported as skipped, the same as any other output
   (must-still-work #1).
7. As a v1 user, I want my `log tracks` applets imported unchanged.
8. As a maintainer, I want the plugin to pass `runConformance`.

## Implementation Decisions

### Package and registration

- `packages/plugins/log-tracks`, named `@ultrasonics/plugin-log-tracks`, depending on
  `@ultrasonics/plugin-sdk` and `zod`.
- `definePlugin` with `name: "log-tracks"`, `mode: ["playlists"]`, one `outputs` handler with an
  empty `instanceSettings.outputs` object (it renders no form, ADR-0019 §6), no `auth`, no
  `persistentSettings`, no `test()`.

### The handler

For each playlist, by position:

- **Empty:** `skipped`, code `empty`.
- **Otherwise:** one `info` line, `"<name>": <n> songs`, then one `info` line per song:
  `<position>. <artists joined ", "> - <title> [<album>] <id space>:<id> … isrc:<isrc> <location>`,
  leaving out absent fields. Then `written`, with `unmatched: []`.

The song lines are capped at 500 per run, across all playlists. Past the cap, the plugin logs one
`info` line per remaining playlist with its count only, and one final line: "`<n>` song lines
omitted". Open question 1.

Log lines are fire-and-forget (`ctx.log.info`, ADR-0010 §3). The song dict holds no secrets, so
nothing needs redacting.

### v1 import mapping (ADR-0017 §5)

A module accepting `log tracks` at any version (v1 shipped 0.1). v1 had no settings of either
kind, so every slot maps to `{}`. **Fixture test:** one v1 applet with a Spotify input and a log
tracks output.

## Testing Decisions

- A good test drives the handler with a harness context that records log lines, and asserts on the
  lines and the `OutputResult`.
- **`runConformance`** with the `{}` settings fixture. Its default song dict's empty playlist is
  `skipped` `empty`.
- **Cases:** a song with every field; a song with only `title`; the cap reached partway through a
  playlist, with later playlists summarised and the omitted count logged; every playlist once in the
  result.

## Out of Scope

- Writing the song dict to a file. That is custom file's job, or the host's export (ADR-0020 §7).
- Levels, filters or formats as settings.
- A dry-run mode for other outputs.

## Open questions

Each has a recommendation.

1. **Port, reshape or drop?** The roadmap lists `log-tracks` among the Phase 2 ports, and the exit
   gate is "feature parity with v1 *minus the dropped plugins above*". Dropping it would mean
   amending the roadmap.
   - **Recommended:** port it, reshaped as above: one line per song, capped at 500. Its real use in
     v2 is the dry run, since an applet must have an output, and nothing else gives one.
   - Alternatives:
     - Port it literally, as one indented JSON dump per playlist. Faithful, and it can fill the
       10,000-line cap on its own.
     - Drop it. The run view's stage counts and results cover most of the need, but not seeing the
       songs, and not a no-op output. That is a roadmap change for Cal.
2. **What a dry run's outcome is.** `written` means "the playlist reached the service" (ADR-0020
   §3), and the log isn't really a service.
   - **Recommended:** `written`, so a dry run ends `succeeded` and reads as a working applet.
   - Alternative: `skipped` with code `dry-run`. Honest, and since skips never change the outcome
     (ADR-0020 §5), the run still ends `succeeded`. Run history would then show every playlist as
     skipped, which reads like something went wrong.

## Further Notes

- **Tickets: one**, and the smallest cell in the phase. A good first plugin for whoever opens the
  Phase 2 wave, since it exercises a plugin package, registration, conformance and an importer
  mapping with no service in the way.
- **No change to the plugin SDK contract.**

## Planned tickets

1. **The log tracks output.** Package, registration, handler, the v1 mapping and its fixture test.
   - [ ] Each non-empty playlist logs a header and one line per song, and is `written`.
   - [ ] Empty playlists are `skipped` `empty`.
   - [ ] Song lines stop at the cap, and the omitted count is logged.
   - [ ] `runConformance` passes.
   - [ ] The v1 fixture maps to `{}`.
   - [ ] `/verify`: a Spotify input into log tracks shows its songs in the run view.
