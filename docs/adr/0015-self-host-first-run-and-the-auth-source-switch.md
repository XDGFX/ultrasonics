# ADR-0015 — Self-host first run and the auth-source switch

**Status:** Accepted
**Date:** 2026-10-15
**Refines:** ADR-0007 (session sources), ADR-0008 (self-host has no login wall)
**Amends:** ADR-0008 §4, which kept the name `DISABLE_AUTH`, and ADR-0009 §5, which had self-host's
bootstrapped session stored as a `sessions` row that never expires.
**Ticket:** [`docs/plans/tickets/011-self-host-first-run.md`](../plans/tickets/011-self-host-first-run.md)

## Context

ADR-0007 has one middleware that always resolves a `Session`, from one of three sources. ADR-0008
removed any login wall from self-host, so a self-hoster's real choice is between the bootstrapped
account and a trusted reverse proxy. That left several things open: how the account comes to exist,
what the switch is called, what a proxy is trusted on, and what happens to an install that is
exposed by accident.

ADR-0009 §6 set a precedent: the app refuses to boot without an `ENCRYPTION_KEY`, and accepts `auto`
as a deliberate opt-in. Every self-hoster therefore edits configuration before the first run anyway.

## Decision

### 1. Security properties are chosen explicitly, never by default (house style)

ADR-0009's `ENCRYPTION_KEY` pattern is adopted as the general rule. A setting that decides a security
property has no silent default. If it is unset, the app exits with a message that explains the
choices. The example compose file ships with every such line filled in, so a copy-paste install
still has no extra steps. A configuration line is not a login prompt, so the Phase 1 exit gate holds.

### 2. `AUTH_SOURCE` replaces `DISABLE_AUTH`

`AUTH_SOURCE` takes `bootstrapped`, `proxy` or `oauth`, and it is **required** (§1). The values
match the glossary's session sources. A boolean could not express three sources, and the old name
said "disable" about something that never disables anything. The middleware still always runs
(ADR-0008 §4); only the name and the set of values change. `oauth` is hosted in practice (ADR-0008).

### 3. The account is created at boot, in every mode

Boot runs in this order: check configuration, copy the database and run migrations (ADR-0009 §7),
then insert one row into `accounts` if the table is empty. This happens whatever `AUTH_SOURCE` is,
so the account exists before any source resolves to it, and changing source never creates a second
one. The account holds only `id` and `created_at`. There is no email and no identity row.

The bootstrapped source builds its `Session` on each request, with no cookie and no `sessions` row.
On an install with one account, a row that never expires would record nothing. `sessions.expires_at`
can therefore be non-nullable unless the hosted tier finds a use for `NULL`.

### 4. Trusted-proxy mode trusts addresses, not headers

`AUTH_SOURCE=proxy` requires `TRUSTED_PROXIES`, a list of CIDRs, and the app refuses to boot without
it. The identity header is set by `PROXY_USER_HEADER`, which defaults to `Remote-User` (Authelia,
Authentik). Each request is handled as follows:

- **From a trusted address, header present:** resolves to the account.
- **From a trusted address, header missing or empty:** 401.
- **From any other address:** 401, whatever headers it carries.

None of these cases falls back to `bootstrapped`. `X-Forwarded-Proto` and `X-Forwarded-Host` are
honoured only from `TRUSTED_PROXIES`.

### 5. The proxy authorises; it does not identify

Any non-empty header value resolves to the install's one account. The proxy decides *who* may come
in; ultrasonics only needs to know that someone did. The value is logged for audit and never stored
as an identity, so there is no `federated_identities` row with provider `proxy`.

Switching from `bootstrapped` to `proxy`, or back, changes only the source the middleware uses. The
account and its data stay where they are, and there is nothing to migrate.

**Self-host has one account and does not support several users.** People who share a proxy share
one account. Anyone who needs separate data runs a separate container.

### 6. An exposed install gets a warning, not a block

In `bootstrapped` mode, a request whose source address is not private logs a warning and shows a
banner in the UI. It is not refused. Address checks fail in both directions:

- **False positives:** a LAN client can have a global IPv6 address, and Tailscale uses 100.64/10.
- **False negatives:** the usual way an install is exposed is through a reverse proxy, which
  connects from a private address. Docker's userland proxy also rewrites every source address to
  the gateway's.

The control that matters is §1: whoever runs `bootstrapped` chose it in writing.

### Out of this decision

- **URL subpath (#37):** deferred. Phase 1 serves from the root and uses relative redirects, so a
  subpath can be added later.
- **Install targets other than Docker** (Unraid, Yunohost, systemd, Windows): packaging work, not a
  contract.
- **Operator-level BYO client credentials (ADR-0013 §7):** entered in the UI and stored in
  `instance_settings`, not passed as environment variables. Which form renders them belongs to
  ticket 016.

## Consequences

- A first run needs two lines in the compose file: `ENCRYPTION_KEY` and `AUTH_SOURCE`. The example
  compose file is part of the self-host onboarding work in Phase 1.
- A misconfigured proxy fails closed with a 401. Nothing falls back to the open source.
- An operator can move from no wall to a proxy wall without touching their data.
- `DISABLE_AUTH` does not exist in v2. v1 never had it, so there is no setting to carry over.
- Rejected:
  - **Silent `bootstrapped` default:** the operator never chooses whether to have a wall.
  - **Blocking public addresses:** false positives on IPv6 LANs.
  - **Pinning the first proxy username:** pointless with one account.
  - **A shared-secret header:** one more secret for a self-hoster to manage, where an address list
    is something they already know.
