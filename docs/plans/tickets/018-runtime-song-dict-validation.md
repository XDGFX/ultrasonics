# 018 — Does the runner validate the song dict at run time?

**Status:** resolved · **Type:** grilling ⛔ (plugin SDK contract) · **Blocked by:** — · **Blocks:** — ·
**Claimed by:** Claude (session 2026-10-15, with Cal)

## Question

Does the runner Zod-parse the song dict at each plugin boundary on every run: what an input
returns, and what a modifier returns? If it does, what happens to data that fails: the whole run
fails, the playlist is skipped, or the bad songs are dropped and reported? And who is blamed: the
plugin, or the service behind it?

## Context

The conformance test ([`plugin-sdk-v2.md`](../../proposals/plugin-sdk-v2.md#conformance-test))
checks that "inputs return a schema-valid song dict", but only against fixtures. It cannot see bad
data that a live service returns. v1 shipped an input that emitted the wrong key (#59, found by
[009](009-issue-triage.md)), and nothing caught it until a user did.

The Phase 1 slice crosses this boundary twice (Spotify input → Plex output), so the runner has to
decide it before the slice is built. Related decisions to read, not re-litigate:

- ADR-0010: the Worker-shaped boundary already `structuredClone`s across it. Parsing is a second
  pass at the same seam, so its cost on a large dict belongs in the answer.
- ADR-0020: outputs report `written | skipped | failed` per playlist, and runs end
  `succeeded | partial | failed | interrupted`. A validation failure needs a place in that model.
  Inputs have no result yet (fog on the map).
- ADR-0006: the song dict's shape is sacred. This ticket decides *enforcement*, not shape.

## A good resolution

- Yes or no. If yes: which boundaries, strict or lenient parse (unknown keys stripped, kept, or
  rejected), and what a failure does to the playlist and to the run status.
- Whether the conformance test changes as a result, and whether this clears the remaining
  conformance fog on the map.
- An ADR. This is a checkpoint gate, so Cal accepts it.

## Answer

Agreed with Cal on 2026-10-15 across two grilling rounds. The decision is
[ADR-0021](../../adr/0021-the-runner-validates-the-song-dict.md), accepted by Cal at
the checkpoint. In short:

1. **Yes.** The runner parses what every input and modifier returns, per plugin and before
   merging. Outputs are not parsed again.
2. **Lenient at run time, strict in conformance.** Unknown keys are stripped with one warning per
   plugin per run; `runConformance` rejects them.
3. **Drop only what failed:** a bad song, a bad playlist, or, if the whole return is malformed, the
   plugin is treated as having thrown.
4. **The plugin is blamed,** named with its component; sanitising service data is its job.
5. **Recorded by the runner** as `rejected` entries in `runs.results`, capped at 50 in detail.
6. **Outcome:** any rejection caps the run at `partial`, or `failed` if nothing was written
   (amends ADR-0020 §5).
7. **Conformance** runs the same validator strictly over fixture outputs: the sixth invariant. This
   clears the conformance fog on the map.

Cost was measured, not guessed: about 25 ms for 50,000 songs with Zod 4, against about 100 ms for
`structuredClone` of the same dict. Whether `title` is `.min(1)` is shape, left to the song-dict
port.
