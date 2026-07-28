# ADR-0003 — Full multi-tenancy, with a single-tenant self-host default

**Status:** Accepted
**Date:** 2026-07-28

## Context

The hosted tier (ADR-0002) is inherently multi-tenant: many accounts, each owning isolated
applets, credentials, and run history. The free self-host deployment is the opposite: one person,
their homelab, ideally no login friction. These pull the data model in opposite directions, and
retrofitting a tenant boundary onto a single-tenant schema later — every table, query, and route
gaining an owner scope under launch pressure — is one of the more painful migrations in software.

The owner is comfortable with full multi-tenancy in self-host (many self-hosted apps have
accounts), provided the single-user experience stays frictionless.

## Decision

Build **full multi-tenancy from day one**, and run **the same code in both deployments** — they
differ by configuration, not architecture:

- Every persisted row and API route carries an owner/tenant scope. The **core** domain logic
  (song dict, fuzzymatch, applet runner) stays tenant-agnostic — it transforms data handed to it
  and knows nothing of tenants.
- **Self-host** runs as a single tenant with a frictionless default: first-run bootstraps an
  admin account, auto-login / remember-me keeps it out of the way, and `DISABLE_AUTH` /
  trusted-reverse-proxy mode exists for users who already run Authelia et al. in front.
- **Hosted** turns the same scope into real isolation behind an account/auth front door.

## Consequences

- Kills the "works in hosted, breaks in self-host" class of bugs — there is one code path.
- Accounts/auth land in the foundation (Phase 0–1), not later. Real scope moved earlier; this is
  the deliberate cost of the revenue ambition (ADR-0002).
- The persistence layer is designed around a tenant context from the first migration; there is no
  later "add multi-tenancy" project.
- Self-host UX work (bootstrap, auto-login, auth escape hatch) is a first-class requirement, not
  an afterthought — a login wall would be a regression against v1, which had none.
