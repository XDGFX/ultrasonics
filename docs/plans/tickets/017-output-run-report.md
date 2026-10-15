# 017 — Does an output report what it did?

**Status:** resolved · **Type:** grilling ⛔ (plugin SDK contract) · **Blocked by:** 009 ✅ · **Blocks:** — ·
**Claimed by:** Claude (session 2026-10-15, with Cal)

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

## Answer

Agreed with Cal on 2026-10-15, across three grilling rounds, and accepted at the checkpoint. The
decision is [ADR-0020](../../adr/0020-outputs-return-a-result.md). In short:

1. **Yes, as a return value.** `outputs(ctx)` returns a required `Promise<OutputResult>`. A
   fire-and-forget `ctx.report()` was rejected: no type forces the call. Inputs and modifiers are
   unchanged.
2. **One entry per playlist, by position in `ctx.songs`,** each exactly once. The runner treats a
   gap or duplicate as the output breaking the contract; `runConformance` gains a fifth invariant.
3. **Status** `written | skipped | failed`, with `{ code, message }` on the last two. A playlist's
   failure is data; a throw means the whole output failed.
4. **Unmatched songs as positions;** the runner derives supplied and matched. No match confidence
   yet.
5. **Run outcomes** `running | succeeded | partial | failed | interrupted`. Unmatched songs and
   skips never change the outcome.
6. **Storage:** a JSON `results` column on `runs`, holding copies of the unmatched songs.
7. **Seen in** Phase 1 run history (per-playlist line, unmatched list one click away); a host-side
   export replaces PR #45's not-found file and may slip to Phase 2; notifications get content but
   no channel.
