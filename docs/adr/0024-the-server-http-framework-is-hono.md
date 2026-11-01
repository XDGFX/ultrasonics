# ADR-0024 — The server's HTTP framework is Hono

**Status:** Accepted
**Date:** 2026-11-01
**Builds on:** ADR-0001 (Bun, Zod, WebSocket run logs), ADR-0007 (one session middleware),
ADR-0018 (the inbound webhook), ADR-0019 (settings forms from JSON Schema)
**Evidence:** [`docs/research/http-framework.md`](../research/http-framework.md)
**Ticket:** [The server's HTTP framework](https://github.com/XDGFX/ultrasonics/issues/102)

## Context

ADR-0001 put `packages/server` on Bun but did not choose an HTTP layer. The candidates were plain
`Bun.serve` with its `routes` API, Hono and Elysia.

## Decision

`packages/server` uses **Hono** on Bun's native server, with the Bun adapter, and validates with
Zod v4 through `@hono/zod-validator` or `@hono/standard-validator`. It starts on Hono 5 if that is
stable when the server ticket is claimed, and on Hono 4.13 with `@hono/bun` otherwise. Both majors
support that adapter.

- **Zod at the boundary.** Hono's validator middleware takes a Zod v4 schema for each request
  part and types `c.req.valid()` from it, so nothing is hand-declared.
- **Sessions.** ADR-0007's single middleware sets the `Session` on a typed context variable, and
  every handler reads it from there.
- **WebSockets.** `upgradeWebSocket` calls Bun's `server.upgrade()`, and Bun's topic pub/sub
  stays available.
- **Tests.** `app.request()` runs routes in-process under `bun:test`, without a port.
- **Lock-in is low.** A Hono app is a `fetch(Request) => Response` function.

## Considered options

- **Plain `Bun.serve`.** It has routes, typed params, cookies and WebSocket upgrades. It has no
  middleware chain, no validation and no in-process test harness, so `packages/server` would build
  and maintain its own.
- **Elysia.** Its own schema language is TypeBox, which ships even when every route uses Zod, and
  OpenAPI from Zod needs a hand-written mapping. Elysia 2.0 is a full rewrite still in release
  candidate, and it removes `resolve`, which a session middleware would use. One maintainer wrote
  two thirds of the last year's commits.

## Consequences

- WebSocket upgrades and `getConnInfo` need a real Bun server. Tests for those paths run on
  `port: 0`. The session middleware takes the client-IP lookup as a parameter so its trusted-proxy
  tests run in-process.
- Hono fills `ws.data` itself, so the socket handler gets the session from the request context
  when the upgrade happens. Publishing to a topic from outside a request needs the `Server` that
  `Bun.serve` returns, and the server spec must name how that reaches the runner.
- OpenAPI is not part of this decision. `@hono/zod-openapi` does not generate its schemas with
  `z.toJSONSchema`, so it could disagree with the settings forms (ADR-0019).
