# 017 — Does an output report what it did?

**Status:** Open · **Type:** grilling ⛔ (plugin SDK contract) · **Blocked by:** 009 ✅ · **Blocks:** — ·
**Claimed by:** —

## Question

Outputs return `void` (ADR-0012, `plugin-sdk-v2.md`). Should an output return a structured result
per playlist (songs supplied, songs matched, and the unmatched songs), so the runner can report what
a run actually did? If so, what is the smallest additive shape?

## Context

The issue triage ([009](009-issue-triage.md), must-still-work #8 in
[`v1-issue-triage.md`](../../reference/v1-issue-triage.md)) found that users repeatedly could not
tell what a run had done. In #30, writes failed with silent 500s and the run still reported success.
In #32, 1,200 of 10,000 songs matched and nothing said so. On PR #45, users asked for a not-found
file that is replaced on every run. Today an output can only log lines or throw.

Freezing the SDK is this map's destination, and the Phase 1 slice ends at the Plex output, so this
has to be settled now. Adding the shape later is possible, but any output written without it would
need revisiting.

## A good resolution

- Yes or no. If yes, the result shape (a Zod schema), whether it is optional for an output, and
  where the runner surfaces it: run history, the UI, and the notifications fog.
- An amendment to ADR-0012 or a superseding ADR. This is a checkpoint gate, so Cal accepts it.
