# ADR-0021 — The runner validates the song dict at each plugin boundary

**Status:** Accepted
**Date:** 2026-10-15
**Builds on:** ADR-0006, superseded by ADR-0022 (the song dict as a Zod schema), ADR-0010 (the plain-data
boundary), ADR-0020 (run outcomes and the `results` column)
**Amends:** ADR-0020 §5, where a rejection now caps the outcome; `docs/proposals/plugin-sdk-v2.md`,
where return types were "enforced by the handler's type, not by a runtime check in the runner".
**Ticket:** [`docs/plans/tickets/018-runtime-song-dict-validation.md`](../plans/tickets/018-runtime-song-dict-validation.md)

## Context

v1 never validated the song dict. Bad data surfaced as a `KeyError` in whichever plugin read it
next: the Plex input emitted `title` instead of `name` and broke every output (#59), and a Spotify
track with a blank name reached Plex with no `title` and crashed a large sync (#38). Must-still-work
#4 ([`v1-issue-triage.md`](../reference/v1-issue-triage.md)) asks that every input emit a valid song
dict and that a violation name the plugin; #2 asks that one bad song or playlist never abort a run.

ADR-0012 left return types to the compiler, which is right for types. But no type sees what a
service actually returns, and the conformance test only sees fixtures. #38 is exactly that gap.

## Decision

### 1. The runner parses what every input and modifier returns

On every run, per plugin and before merging, so a violation names the plugin and its component
(`inputs` of `spotify`). Outputs are not parsed again: what they receive was parsed as it left the
plugin before them.

### 2. Unknown keys are stripped, with a warning

At run time the schema strips keys outside the song dict's shape, and the runner logs one warning
per plugin per run listing them. Passthrough was rejected because it would let plugins pass private
data through the interchange format; strict because one harmless extra field would fail a sync.

### 3. Only what failed is dropped

- A song that fails is dropped; the rest of its playlist carries on.
- A playlist that fails its own fields (`name`, `songs`) is dropped with all its songs.
- A return that fails as a whole (not a list) is treated as the plugin throwing.

So the runner `safeParse`s each playlist and each song, not the dict once.

### 4. The plugin is blamed, never the service

The runner cannot tell a service's bad data from a plugin's bug, and must-still-work #5 already
makes sanitising service data (null tracks, local files without ids) the plugin's job. A rejection
means the plugin let it through.

### 5. Rejections are recorded by the runner in `results`

The runner writes a `rejected` entry per plugin into the run's `results` column (ADR-0020 §6): for
each rejection, the playlist's position and name, the song's position and title where present, and
the Zod issue path and message. Detail is capped at the first 50, then a count. Plugins return
nothing new; inputs still have no result of their own.

### 6. A rejection caps the run's outcome

A rejection is the plugin breaking the contract, which ADR-0020 §5 already counts. Amending §5:

- Any rejection makes the run at best `partial`.
- A rejection after which nothing was written makes it `failed`.

Without this, #59 would end `succeeded`: every playlist rejected, the outputs given an empty dict,
and every playlist (of none) counted as written. Skipped playlists still never change the outcome;
a skip is the plugin's deliberate choice, a rejection its bug.

### 7. Conformance runs the same validator, strictly

`packages/plugin-sdk` exports the validator beside the `SongDict` schema. `runConformance` runs it
in strict mode over each input's and modifier's fixture output and fails on any issue: an unknown
key, a rejected song, a rejected playlist. This is the sixth machine-checked invariant, and it is
what "inputs return a schema-valid song dict" means.

## Considered options

- **No runtime parse; fixtures and plugin hygiene only.** Rejected: cannot catch #38, and a
  violation surfaces in the wrong plugin.
- **Parse only in development or behind a flag.** Rejected: production is where bad data arrives.
- **Parse the merged dict once.** Rejected: loses which plugin to blame.
- **Fail the run on any violation.** Rejected: breaks must-still-work #2.
- **Rejections in `ctx.log` only.** Rejected: #59 would recur as a quiet empty sync.
- **An input result now.** Deferred: the runner finds rejections, not the plugin, so none is needed.

## Consequences

- Cost is negligible. Measured with Bun 1.4.2 and Zod 4.6.7 on 50,000 populated songs: about 25 ms
  to parse the dict, about 23 ms song by song, against about 100 ms for ADR-0010's
  `structuredClone`. Strip, passthrough and strict differed by less than the noise.
- A `duration` key, which v1 occasionally emitted, is stripped and warned about rather than carried.
- Whether `title` must be non-empty (`.min(1)`) is shape, not enforcement, and is left to the
  song-dict port.
- `runs.results` grows by at most 50 detailed rejections per plugin per run.
