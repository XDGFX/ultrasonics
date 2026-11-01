# ADR-0026 — Run events are server-sent events

**Status:** Proposed
**Date:** 2026-11-01
**Supersedes:** the "WebSocket run logs" in ADR-0001's package layout and ADR-0024's WebSockets note
**Builds on:** ADR-0007 (one session middleware), ADR-0009 §5 (run records), ADR-0020 (output
results), ADR-0021 (rejections), ADR-0024 (Hono), ADR-0025 §4 (the run view)
**Ticket:** [Run-log streaming: transport and message shape](https://github.com/XDGFX/ultrasonics/issues/106)

## Context

The run view shows a live run's stages with song counts, its output results, its rejections and its
log (ADR-0025 §4). ADR-0001 named WebSockets for this in passing, and nobody had chosen a transport.
The stream only ever flows from server to browser.

## Decision

### 1. One SSE stream per run

`GET /runs/:id/events` is a server-sent event stream (Hono `streamSSE`), passing through the
session middleware like any other route. It looks the run up through the scoped store before
subscribing, and returns 404 for a run outside the session's account. Heartbeats are SSE comment
lines, which keep Bun's idle timeout from closing the stream. The response sets
`X-Accel-Buffering: no` for reverse proxies.

### 2. Five run events

A **run event** is a Zod discriminated union shared by the server and the UI. Every event carries a
`seq`, which increases within its run and doubles as the SSE `id`, and an `at` timestamp.

- `log` — `level`, `source` (`runner` or the component's plugin), `text`
- `stage` — the component's position and plugin, `started` or `finished`; on `finished`, songs
  out, playlists out and rejected count. A stage is one component instance; there is no progress
  within one.
- `rejection` — one per rejection, in the shape ADR-0021 stores
- `result` — one per output as it finishes, carrying its ADR-0020 result
- `end` — the run's final status

### 3. The runner emits; the server fans out

The runner takes a `RunEvents` sink from whoever starts the run and knows nothing of HTTP. The
server's in-process hub keeps a **journal** of each live run's events, with ADR-0009's log cap
applied to its `log` events. A subscriber gets replay from `Last-Event-ID + 1`, or from the first
event, followed by the live feed. The client closes its `EventSource` on `end`.

### 4. The stored run is the journal

The journal is written to the `runs` row at each `stage` finish, at most every five seconds, and at
`end`, after which the hub drops it. An interrupted run therefore keeps everything up to its last
write. Opening the stream for a finished run replays the stored record as events, then `end`, so
the UI has one code path.

### 5. A queued run has no run yet

A run's row is created when it starts. "Run now" on a busy applet answers `queued`, not a run id.

## Considered options

- **WebSockets** (`upgradeWebSocket` with Bun topic pub/sub). Rejected because nothing flows
  from browser to server. It also fails silently behind a proxy that lacks `Upgrade` headers,
  catch-up has to be hand-built, and publishing outside a request needs the `Bun.serve` `Server`
  (ADR-0024).
- **One stream per account**, which also carries applet status. Rejected for Phase 1: nothing
  needs the applet list to update live.
- **Logs stored as plain text.** Rejected because live and stored runs would then render from
  different data.

## Consequences

- ADR-0009 §5 gains structured log lines, a `stages` column and writes during the run.
- Each open run view holds one HTTP/1.1 connection. Browsers allow six per origin, which matters
  only when several run views are open at once without HTTP/2.
