# 004 — Trigger model and runner semantics

**Status:** ✅ resolved 2026-08-04 (agreed by Cal in session) · **Type:** grilling ·
**Blocked by:** 014 ✅ · **Blocks:** 005 · **Claimed by:** wayfinder session 2026-08-04

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

## Context

**[014](014-trigger-candidates.md) resolved 2026-08-04 — the evidence is in hand; read its Answer
before resuming.** A grilling session opened on the
SDK shape — is a trigger a `run()` plugin, a distinct `schedule()`/`subscribe()` shape, or not a
plugin at all? — and Cal stopped it at the first question: *evaluate what is worthwhile having as a
trigger before committing to anything*. The shape follows the set. If the valuable triggers are a
schedule and an inbound webhook, both are server capabilities and the Trigger component may not
belong in the SDK at all; if they are service-specific (new-album-drop and friends), a plugin shape
earns its keep.

One observation for whoever resumes this: `docs/proposals/plugin-sdk-v2.md` already types
`RunContext.component` as `"inputs" | "modifiers" | "outputs"` — **triggers are absent**. The sketch
had already stopped treating a trigger as something that runs. That is a drafting artefact, not a
decision, but it points the same way.

Note that ruling on this touches `CONTEXT.md` (**Trigger**, **Applet** — "zero or more Triggers" as
components) and `roadmap.md` (Phase 2 lists `webhook` and `time-trigger` as plugin cells). Whichever
way it goes, those need updating in the same resolution.

## Answer

→ **[ADR-0011](../../adr/0011-triggers-are-server-capabilities-not-plugins.md)** holds the decision
and its reasoning. Evidence: [014](014-trigger-candidates.md) and its
[research](../../reference/trigger-candidates-research.md).

**A Trigger is not a plugin.** The `Trigger` **Component** is removed from the SDK, which freezes at
three component types — `inputs`, `modifiers`, `outputs`. Triggers become **applet configuration
owned by the server**: a schedule, and/or an authenticated inbound webhook URL.

Taking the ticket's three questions in turn:

**1. The SDK shape.** Neither `run()` nor a new `schedule()`/`subscribe()` shape — no trigger shape at
all. Ticket 014 established that every trigger worth building (schedule, inbound webhook, outbound
webhook, run-now, file watch) is a capability of our own server, needing no handshake, settings
schema, `run()`, credentials or `AuthProvider`. The only candidate that would have justified a
service-specific plugin family — "a followed artist released a new album" — is unobtainable at sane
cost, because no music service offers push and Spotify's cheap shared-poll route is deprecated.

The applet keeps its IFTTT mental model in the **UI**; only the implementation changes.

**2. The AND→OR bug — dissolved, not fixed.** OR, hardcoded, no per-applet setting. With no set of
trigger plugins whose firings must be combined, there is no combination logic left to get wrong. AND
is close to incoherent for configuration ("run at 06:00, but only if the webhook also fired"), and
nothing in the v1 backlog asks for it. It remains a **runner** semantic in `packages/core` — the
ticket's real concern, that it would otherwise be settled inside a Phase 2 plugin cell, is answered
by there being no Phase 2 trigger plugin at all.

**3. Where the scheduler picks up intent.** No longer fog — the server owns it outright, and it is
ticketed as **[015](015-scheduler-architecture.md)**: persistence, schedule expression, missed runs
across downtime, restart durability, wake resolution, and the webhook endpoint's shape and auth.

**Plus one semantic the ticket did not anticipate**, surfaced because server-owned scheduling makes it
possible for the first time (v1 blocked inside the trigger, so it never could): **a trigger firing
while its applet is already running queues it, at a queue depth of one.** Not skip — a silently
dropped trigger is confusing in a way a delayed run is not. Not unbounded — an applet slower than its
own interval would queue forever doing identical work. Further triggers are absorbed into the pending
run, and the applet shows a `queued` state. Concurrency across *different* applets stays allowed.

## Downstream edits made in this resolution

- `CONTEXT.md` — **Trigger** is no longer a **Component**; **Applet** no longer lists Triggers among
  its components.
- `roadmap.md` — Phase 2 loses the `webhook` and `time-trigger` plugin cells; the scheduler and
  webhook route become Phase 1 server work.
- `docs/proposals/plugin-sdk-v2.md` — the open trigger question is closed.
- New ticket [015](015-scheduler-architecture.md), graduated from the map's fog.

## Deferred, not rejected

**Outbound webhook on sync completion** and **local file/folder watch**. Both are server capabilities
under this decision, so neither needs a contract frozen now. The outbound webhook is worth noting:
014 found it has the *better* demand signal of the two directions — Plex and Jellyfin both ship
webhook senders with maintained Home Assistant blueprints, with no equivalent inbound.
