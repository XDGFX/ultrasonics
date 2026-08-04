# 2026-08-04 — Trigger model (map tickets 004, 014)

Wayfinder session on `docs/plans/map.md`. Took the first frontier ticket, 004.

## What happened

Opened the grilling on 004's first question — is a Trigger a `run()` plugin, a distinct
`schedule()`/`subscribe()` shape, or not a plugin at all? Cal stopped it immediately: **decide what is
worth having as a trigger before committing to a shape.** That prior question had no owner, so it
became ticket **014** and 004 was blocked behind it.

014 ran as an AFK `/research` ticket and came back decisive. Every trigger candidate that survives
scrutiny — schedule, inbound webhook, outbound webhook, run-now, file watch — is a capability of our
own server, needing no handshake, settings schema, `run()` or credentials. The one candidate that
would have justified a service-specific plugin family ("a followed artist released a new album") is
unobtainable: no music service offers push, and Spotify's cheap shared-poll route is deprecated.

The single most useful finding came from Cal's own hunch about generic hooks: Home Assistant,
Node-RED, IFTTT and Zapier *all* ship a generic outbound HTTP action, so **one** authenticated
endpoint serves every one of them. "Integrate with Home Assistant" is documentation, not a plugin.

004 then resolved to **C: a Trigger is not a plugin.**

## Decisions taken

- **[ADR-0011](../adr/0011-triggers-are-server-capabilities-not-plugins.md)** — `Trigger` removed as
  a Component; the SDK freezes at three (`inputs`/`modifiers`/`outputs`). Triggers become server-owned
  applet configuration. Combination is **OR**, hardcoded, no per-applet setting — the AND→OR bug
  dissolves rather than being fixed. A trigger firing during a run **queues at depth one** with a
  visible `queued` state; concurrency across *different* applets stays allowed.
- Deferred, not rejected: outbound webhook on completion, local file/folder watch.

## Raised and deliberately not changed

The **Phase 1 exit gate targets Spotify → Plex, which Cal cannot test** — he has no self-host setup
and can only run hosted, which by ADR-0002 launches cloud-services-only precisely because the cloud
cannot reach a home Plex. Put to him as a fork: keep it, or move the vertical slice to a cloud→cloud
pair he could verify himself. **He kept it** — both matter, and reordering the plan to route around
work that must happen anyway is not a real saving. ADR-0002 stands, no superseding ADR. Noted in
`roadmap.md` as reaffirmed so it is not re-raised.

Cal also corrected the framing that hosted is "out of scope": the *map's* out-of-scope is narrow and
means "not a Phase 0 contract question", not deprioritised. Hosted is his main interest and the only
tier he can test. The Phase 5 sequencing traces to ADR-0002 §6 and the 28 July kickoff, so it is his
own prior decision, not an agent's invention — but worth knowing it sits four phases ahead of what he
cares about most.

## Files changed

- `docs/adr/0011-...md` (new), `docs/reference/trigger-candidates-research.md` (new, ~7,000 words)
- `docs/plans/tickets/014-...md` (new, resolved), `015-scheduler-architecture.md` (new, graduated
  from fog), `004-trigger-model.md` (resolved)
- `docs/plans/map.md`, `docs/plans/roadmap.md`, `CONTEXT.md`, `docs/proposals/plugin-sdk-v2.md`

## Next

- **005 (SDK surface freeze) is unblocked** — both its blockers are now resolved. It is a ⛔
  checkpoint ticket and is the critical path.
- **015 (scheduler architecture)** is new on the frontier: where scheduled intent persists, how the
  schedule is expressed, missed runs across downtime, and the webhook endpoint's shape and auth.
- Carried at the scope boundary, **not** ticketed: a reported **Spotify platform-access wall** (dev
  mode user cap, extended quota needing a registered business above a high MAU threshold). Bears on
  ADR-0002 and on whether `Proxy` is viable for Spotify. Hosted-tier, so out of this map's scope —
  **and the figures are second-hand and must be reconfirmed** against Spotify's own terms.
