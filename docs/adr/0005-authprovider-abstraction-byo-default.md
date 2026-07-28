# ADR-0005 — AuthProvider abstraction, bring-your-own by default

**Status:** Accepted
**Date:** 2026-07-28

## Context

v1 could not ship secret OAuth keys in open-source client code, so it routed public-service auth
(Spotify, Last.fm, Deezer) through **ultrasonics-api**, a separate hosted proxy holding the
secrets. It ran on Heroku's free tier and died in Nov 2022, breaking the flagship Spotify sync for
every new user — the central reason the project is broken on a fresh install today.

The revival must serve two auth worlds from one codebase (ADR-0003): a self-hoster who supplies
their own credentials and must work fully offline, and a hosted tier (ADR-0002) where ultrasonics
holds app credentials and login is one click with no keys.

## Decision

Introduce a swappable **`AuthProvider`** interface. A plugin declares *what* auth it needs; it
never encodes *how* credentials are obtained. Implementations:

- **BYO** (default) — the self-hoster registers their own developer app and supplies the client
  ID (and secret only where a service leaves no alternative). Always works offline. The default.
- **PKCE** — for services that support it (e.g. Spotify), no client secret is stored at all.
- **Proxy** — credentials brokered by a hosted service (the hosted tier, or an optional community
  proxy). Same interface; the plugin code is unchanged.

Credentials are stored per tenant (ADR-0003). A first-run setup wizard makes BYO painless.

## Consequences

- Phase 1 ships self-host-first with **zero hosting burden** — BYO + PKCE need nothing running.
- The hosted tier becomes an *additive* `Proxy` implementation plus app registrations, not a
  rewrite of plugin auth.
- `ultrasonics-api` is not resurrected; it survives only as a historical reference in `CONTEXT.md`.
- The `AuthProvider` interface and credential storage are a **checkpoint gate** (AGENTS.md).
- Some services will only ever be BYO/offline-appropriate; the hosted tier's coverage is governed
  by ADR-0002 (ship-all, gate reactively), not by this interface.
