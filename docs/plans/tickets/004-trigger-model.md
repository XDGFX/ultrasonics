# 004 — Trigger model and runner semantics

**Status:** Open · **Type:** grilling · **Blocked by:** — · **Blocks:** 005 · **Claimed by:** —

## Question

How does a **Trigger** work in v2 — and does the SDK model it as `run()` at all?

Two things are entangled here, and neither had an owner:

**1. The SDK shape.** v1's webhook trigger spins a blocking Flask server until a GET arrives; the
time trigger blocks in `time.sleep`. Both must be re-architected around the Bun server and
scheduler rather than ported literally (`legacy-architecture.md`). So a trigger should *register
intent* — `schedule()` / `subscribe()` — rather than block inside `run()`. Is that a distinct
plugin shape in `definePlugin`, or does `run()` stay and the runner interprets it differently?

**2. The AND→OR bug.** v1's `applet_trigger_run()` requires *all* triggers to fire; the source
comment admits it should be OR. `CONTEXT.md` says "resolve when triggers are rebuilt" and
`legacy-architecture.md` says "Fix in v2" — but this lives in the **runner** (`packages/core`,
Phase 1), while the trigger *plugins* are Phase 2. Left alone it would be silently decided inside
some Phase 2 plugin cell, which is exactly the wrong place for a cross-cutting runner semantic.

Confirm OR is right (it is the documented intent), and decide whether a user can ever want AND —
if so it is a per-applet setting, not a hardcoded change.

## A good resolution

- The trigger shape in the SDK, ready for 005 to freeze.
- OR semantics settled, with the runner — not a plugin — owning them.
- A note on where the scheduler picks up registered intent (the detail can stay fog for now).
