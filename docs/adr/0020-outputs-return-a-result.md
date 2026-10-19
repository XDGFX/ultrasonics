# ADR-0020 — Outputs return a result per playlist

**Status:** Accepted
**Date:** 2026-10-15
**Builds on:** ADR-0010 (plain-data return values, `RunResult`), ADR-0018 (`runs` and its trigger)
**Amends:** ADR-0012 §2, where `outputs(ctx)` returns `Promise<void>`; ADR-0009's `runs` row, which
gains a `results` column and a defined set of outcomes; `docs/proposals/plugin-sdk-v2.md`.
**Amended by:** [ADR-0021](0021-the-runner-validates-the-song-dict.md) §6 — a rejected song or
playlist caps the run at `partial`, or `failed` if nothing was written;
[ADR-0023](0023-the-v2-song-dict-shape.md) §1 — a playlist's position is within `ctx.songs.playlists`
**Ticket:** [Does an output report what it did?](https://github.com/XDGFX/ultrasonics/issues/87)

## Context

An output could only log lines or throw, so the runner could not say what a run had done. In v1
#30, all 15 playlists hit Plex 500s and the applet still reported success. In #32, 1,200 of 10,000
songs matched and nothing said so. PR #45's users asked for a not-found file. Must-still-work #8
([`v1-issue-triage.md`](../reference/v1-issue-triage.md)) asks for a run that shows, per playlist,
how many songs matched out of how many were supplied. Outputs do their own matching, so only the
plugin knows the answer.

## Decision

### 1. `outputs(ctx)` returns a required `OutputResult`

```ts
const PlaylistResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("written"), playlist: z.number().int(), unmatched: z.array(z.number().int()) }),
  z.object({ status: z.literal("skipped"), playlist: z.number().int(), code: z.string(), message: z.string() }),
  z.object({ status: z.literal("failed"),  playlist: z.number().int(), code: z.string(), message: z.string() }),
]);
const OutputResult = z.object({ playlists: z.array(PlaylistResult) });
```

The return type is `Promise<OutputResult>`; `void` is no longer accepted. Inputs and modifiers are
unchanged.

### 2. One entry per playlist, by position

`playlist` is the playlist's position in `ctx.songs`. Names can repeat and the `id` map can be
empty, so a position is the only exact reference. Every playlist appears exactly once. The runner
checks this, and a missing, duplicate or out-of-range entry means the output broke the contract:
it is recorded as a failure of that output, never as success. `runConformance` checks the same rule
against a fixture, as its fifth invariant.

### 3. A playlist's failure is data; a throw is the output's failure

- `written`: the playlist reached the service. Unmatched songs do not change this.
- `skipped`: the output chose not to write it, with a reason (an empty playlist, must-still-work
  #1).
- `failed`: the service refused the write (#30's 500s).

`code` lets the runner tell reasons apart without `instanceof` (ADR-0010 #4), as `TestResult` does.
An output throws only when it cannot work at all, such as bad credentials or an unreachable server.

### 4. Unmatched songs are positions; counts are derived

`unmatched` lists positions within that playlist's `songs`. The runner derives `supplied` from
`songs.length` and `matched` as `supplied − unmatched.length`, so the counts cannot contradict the
input. A song has no guaranteed id, which rules out referencing it any other way. Match confidence
is left out; an optional field can be added later.

### 5. How a run ends

`runs.status` is `running | succeeded | partial | failed | interrupted`:

- `succeeded`: every component completed, and every playlist was `written` or `skipped`.
- `partial`: something was written, but a playlist `failed`, or one output threw or broke the
  contract while another wrote.
- `failed`: an input or modifier threw, or every output threw or broke the contract.
- `interrupted`: unchanged (ADR-0018).

Unmatched songs and skipped playlists never change the outcome. A match-rate threshold would be a
setting with no owner; the fix for #32 is a visible count.

### 6. Storage

`runs` gains a JSON `results` column: one entry per output instance, holding its playlist entries or
its error. When storing, the runner replaces unmatched positions with copies of the songs, since the
input will have changed by the next run. A child table is not needed until something queries across
runs by playlist.

### 7. Where it is seen

- **Run history (Phase 1):** a run's outcome, and per output a line per playlist with status,
  matched/supplied and the reason. The unmatched songs open from that line.
- **The not-found file:** the host exports a run's unmatched songs. No plugin writes files. This
  may land in Phase 2.
- **Notifications:** this is their content, but the channel is not decided here.

## Considered options

- **Keep `void`.** Rejected: the runner learns only whether the output threw, which cannot say
  "matched 1,200 of 10,000".
- **A fire-and-forget `ctx.report()`.** It survives a later throw, but no type forces a call, so an
  output that wrote nothing looks the same as one that forgot to report.
- **An optional result (`OutputResult | void`).** Rejected: `void` would become the default, and
  #30 would recur.
- **Counts and `Song[]` in the result.** Rejected: the plugin's numbers could disagree with each
  other or with the input.
- **Results for inputs and modifiers too.** Deferred. A modifier's effect is visible by diffing
  the song dict; an input's skips go through `ctx.log` until a result is added.

## Consequences

- Every output must handle a failure per playlist rather than letting the first error escape.
- `PluginExecutor.run`'s `RunResult` (ADR-0010) now has a defined shape for outputs.
- `runs` rows grow with unmatched songs, a few hundred KB in the #32 case, which makes `runs`
  retention more pressing.
