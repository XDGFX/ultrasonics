# 2026-10-15 — Does an output report what it did? (map ticket 017)

/wayfinder, working the map. One ticket resolved — the last on the map.

## Done

**Ticket 017 resolved.** Cal agreed across three grilling rounds and accepted at the checkpoint. The
decision is [ADR-0020](../adr/0020-outputs-return-a-result.md), Accepted.

- `outputs(ctx)` returns a required `OutputResult`: one entry per playlist by position, status
  `written | skipped | failed`, unmatched songs by position. Counts are derived by the runner.
- Runs end `succeeded | partial | failed | interrupted`; `runs` gains a JSON `results` column.
- Amended: `plugin-sdk-v2.md` (signature, fifth conformance invariant), ADR-0012 and ADR-0009
  headers, the `runs` row, and `CONTEXT.md` (**Run** outcomes, new **Output result**).
- Fog added: results for inputs, match confidence for review, `runs` retention.

## Next

The map has no open tickets. Phase 0's exit is a checkpoint: Cal to review the map's remaining fog
and confirm the destination is reached, then accept the Proposed ADRs (0007–0019).
