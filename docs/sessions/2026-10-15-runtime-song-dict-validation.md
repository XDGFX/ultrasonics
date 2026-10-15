# 2026-10-15 — Does the runner validate the song dict at run time? (map ticket 018)

/wayfinder, working the map. One ticket resolved — the last on the map.

## Done

**Ticket 018 resolved.** Cal agreed across two grilling rounds. The decision is
[ADR-0021](../adr/0021-the-runner-validates-the-song-dict.md), Proposed.

- The runner parses what every input and modifier returns, per plugin. Unknown keys are stripped
  with a warning; bad songs and playlists are rejected, blamed on the plugin, and recorded in
  `runs.results`. Any rejection caps the run at `partial`.
- `runConformance` gains a sixth invariant: the same validator, strict, over fixture outputs.
- Measured: about 25 ms for 50,000 songs with Zod 4, against about 100 ms for `structuredClone`.
- Amended: `plugin-sdk-v2.md`, the ADR-0020 header, and `CONTEXT.md` (new **Rejection**, **Run**
  outcomes). The conformance fog patch is cleared from the map.

## Next

The map has no open tickets. Cal to accept ADR-0021 at the checkpoint, then confirm Phase 0's
destination is reached.
