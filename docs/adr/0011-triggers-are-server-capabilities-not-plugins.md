# ADR-0011 — Triggers are server capabilities, not plugins

**Status:** Proposed
**Date:** 2026-08-04
**Refines:** ADR-0004 (the typed plugin SDK, which this removes a component type from), ADR-0001
(which inherited v1's four-component model)
**Evidence:** [`docs/reference/trigger-candidates-research.md`](../reference/trigger-candidates-research.md)
**Ticket:** [`docs/plans/tickets/004-trigger-model.md`](../plans/tickets/004-trigger-model.md)

## Context

v1 models a **Trigger** as a plugin sitting in the applet alongside inputs, modifiers and outputs.
Both implementations block: the webhook trigger spins a Flask server until a GET arrives, the time
trigger blocks in `time.sleep`. Neither survives contact with a Bun server and a real scheduler, so
both had to be re-architected regardless — which forced the question of what a trigger *is* before
ticket 005 could freeze the SDK surface.

The obvious move was to keep triggers as plugins but give them a non-blocking shape — `schedule()` /
`subscribe()` registering intent rather than `run()` blocking. Before committing to that, we asked
which triggers are actually worth having (ticket 014). The answer reframed the question.

**Every trigger candidate that survives scrutiny is a capability of our own server, not an
integration with a third-party service:**

- **Schedule** — a timer. Strongly evidenced in both directions: contributed to v1 by the community
  across three PRs, visible unprompted in users' logs, and the universal paywall line at every
  comparable product (Soundiiz, TuneMyMusic, FreeYourMusic, SongShift all gate it).
- **Inbound webhook** — a route in. Home Assistant, Node-RED, IFTTT and Zapier *all* ship a generic
  outbound HTTP action, so one authenticated endpoint serves every one of them. "Integrate with Home
  Assistant" is not a trigger; it is this endpoint plus documentation.
- **Outbound webhook** — a route out, on sync completion. Not a trigger at all, but it surfaced here
  and has the better demand signal of the two directions.
- **Manual run-now** — a button. Already exists.
- **Local file/folder watch** — a filesystem watcher. Self-host only by construction.

The one candidate that would have justified a service-specific trigger *family* — "a followed artist
released a new album" — is the weakest on the list. No music service offers any push mechanism;
Spotify's one cheap shared-poll route is deprecated and removed for development-mode apps, leaving
roughly 816,000 requests/day at 1,000 accounts against an unpublished limit, and Last.fm's equivalent
endpoint no longer exists.

None of the surviving candidates needs a handshake, a settings schema, `run()`, credentials, or an
`AuthProvider`. The entire plugin apparatus goes unused by every trigger worth building.

Supporting evidence, weaker but consistent: in six years nobody wrote a third-party *trigger* plugin,
while the *service* axis drew repeated requests and a substantial TIDAL PR. Extensibility demand is
real, but not on this axis.

## Decision

**1. `Trigger` is removed as a plugin Component.** The SDK has three component types — `inputs`,
`modifiers`, `outputs`. `definePlugin` gains no trigger shape, and ticket 005 freezes the surface
without one. (`docs/proposals/plugin-sdk-v2.md` already typed `RunContext.component` as
`"inputs" | "modifiers" | "outputs"`; this ratifies what the sketch had drifted into.)

**2. Triggers become applet configuration**, owned by the server: a schedule, and/or an
authenticated inbound webhook URL. The applet keeps its IFTTT-shaped mental model in the UI — users
still see "when this, do that" — but the *implementation* is server-side config, not a plugin slot.

**3. Trigger combination is OR, hardcoded, with no per-applet setting.** v1's `applet_trigger_run()`
required *all* triggers to fire; its own source comment admits this was a bug. Any trigger firing
runs the applet. AND is close to incoherent once triggers are configuration rather than components
("run at 06:00, but only if the webhook also fired"), nothing in the v1 backlog asks for it, and a
setting would be speculative generality. **This is a runner semantic and lives in `packages/core`** —
it must not be decided inside a Phase 2 plugin, which is exactly the risk that opened the ticket.

**4. A trigger firing while its applet is already running queues it, with a queue depth of one.**
Not skip: a silently-dropped trigger is confusing in a way a delayed run is not. Not unbounded: an
applet slower than its own interval would grow a queue forever, and every entry would do identical
work. A further trigger arriving while one run is already pending is absorbed into that pending run.
The applet surfaces a **`queued`** state so the behaviour is visible rather than mysterious.

**5. Concurrency across *different* applets is allowed** and deliberately not restricted. Only
same-applet concurrency is serialised.

**6. Deferred, not rejected:** outbound webhook on completion, and local file/folder watch. Both are
server capabilities under this decision, so neither needs a contract frozen now.

## Consequences

- **Ticket 005 is unblocked** and freezes a three-component SDK. One fewer component type to design,
  test and constrain — no trigger shape needs to satisfy ADR-0010's nine boundary constraints.
- **The AND→OR bug dissolves rather than being fixed.** With no set of trigger plugins whose firings
  must be combined, there is no combination logic to get wrong.
- **`CONTEXT.md` changes.** **Trigger** is no longer a **Component**; **Applet** no longer carries
  "zero or more Triggers" as components. Both are amended in this commit.
- **`roadmap.md` changes.** Phase 2 loses `webhook` and `time-trigger` as plugin cells — two fewer
  ports. The scheduler and webhook route become Phase 1 server work instead.
- **The server now owns scheduling**, which was previously nobody's job because the trigger plugin
  blocked. How the scheduler persists intent, survives restarts and handles missed runs is a real
  decision and is ticketed as [015](../plans/tickets/015-scheduler-architecture.md).
- **Run frequency has a real per-account cost.** A no-op sync is cheap in *writes* but not in
  *reads* — "nothing changed" is only knowable after fetching from both services. Accepted: Cal's
  position is that a run costs fractions of a penny, with free-tier rate limits and a cap on active
  applets available as levers (Phase 5 freemium detail, not decided here).
- **A third-party trigger plugin is foreclosed.** Accepted: none exists, third-party install is
  already out of scope, and a future event-source plugin type could be added without breaking a
  contract we never froze.

## Alternatives rejected

- **Keep `run()` for triggers** (v1's shape, polled by the runner). Rejected: it models a timer as a
  plugin that must be repeatedly asked "has it happened yet", which is what produced v1's blocking
  designs and its 120-second polling floor.
- **A distinct non-blocking plugin shape** — `schedule()` / `subscribe()` registering intent. The
  front-runner before ticket 014. Rejected on evidence: it designs an SDK surface, conformance tests
  and isolation constraints for a plugin family whose only members are things the server must
  implement natively anyway.
- **Keeping `Trigger` as a component "for extensibility".** Rejected as speculative: six years, zero
  third-party trigger plugins, and the one service-specific candidate is unobtainable at sane cost.

## Notes

The v1 webhook trigger's disuse is **not** evidence for this decision and was not used as such. It
is over-determined: broken since Werkzeug 2.1.0 (28 Mar 2022) removed the `werkzeug.server.shutdown`
key it depends on with no bug filed in four years, unreachable in the primary Docker distribution
(`EXPOSE` 5000 vs a default of 5001), and never documented anywhere. The inbound webhook is justified
forward-looking — as the single endpoint that serves Home Assistant, Node-RED, IFTTT and Zapier —
not on v1 usage.
