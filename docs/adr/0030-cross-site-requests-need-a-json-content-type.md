# ADR-0030 — Cross-site requests need a JSON content type

**Status:** Accepted (Cal, 2026-11-16)
**Date:** 2026-11-16
**Builds on:** ADR-0015 §3 and §6 (`bootstrapped` has no login; an exposed install gets a warning,
not a block), ADR-0018 §5 (the inbound webhook)
**Spec:** [Spec: the server, its HTTP API, the run stream, the scheduler and the webhook](https://github.com/XDGFX/ultrasonics/issues/134)

## Context

In `bootstrapped` mode every request is the owner, with no cookie (ADR-0015 §3). So any page the
owner visits can make their browser send a request to `http://192.168.1.50:5000/api/…`, and the
server can't tell it from the UI. A plain HTML form can `POST` cross-origin with no preflight, as
long as its content type is `text/plain`, `multipart/form-data` or
`application/x-www-form-urlencoded`. No earlier ADR covered this.

## Decision

**Every mutating `/api` route except `/api/hooks` answers `415` unless the request carries
`Content-Type: application/json`, and the server sends no CORS headers.** A cross-origin request
with that header needs a preflight, and the preflight never succeeds, so a page on another site
can't change the install. The UI is same-origin and unaffected. The check is on the header, so a
`POST` with no body still sends it. `/api/hooks` is exempt because it accepts any content type and
authenticates by its token alone (ADR-0018 §5).

**DNS rebinding is an accepted risk in `bootstrapped` mode.** A rebound hostname makes the attacker's
page same-origin with the install, and this check doesn't stop that. It is accepted in the spirit of
ADR-0015 §6: whoever runs `bootstrapped` chose it in writing, and the control that matters is that
choice.

**A WebSocket route would need its own guard.** Browsers open WebSockets cross-origin with no
preflight, so the content-type check doesn't protect one. Any future WebSocket must reject an
`Origin` that isn't the install's own.

## Considered options

- **A CSRF token.** Rejected: it needs somewhere to live per session, and `bootstrapped` has no
  cookie and no session row.
- **A `Host` allowlist,** which would also stop DNS rebinding. Rejected: one more required setting,
  and it breaks reaching the install by IP.
