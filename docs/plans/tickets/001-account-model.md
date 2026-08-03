# 001 — Account model ⛔

**Status:** **Closed** (2026-08-03, accepted by Cal) · **Type:** grilling · **Blocked by:** — ·
**Blocks:** 002, 006 · **Resolution:** [ADR-0007](../../adr/0007-account-model-sessions-and-the-core-boundary.md)

## Question

What is an account, what is a **tenant**, and how do they relate — in a codebase where self-host
and hosted run the same code (ADR-0003)?

ADR-0003 decided *that* every row and route carries a tenant scope, and that self-host runs as a
single tenant with a fixed owner it never sees. It did not decide the model. Specifically:

- Is there a **user** entity distinct from a tenant, or is a tenant the only principal in Phase 1?
  Hosted eventually wants many users per tenant (or does it? one tenant per account may be enough
  forever) — decide whether that seam exists now or is a later migration.
- What identifies a session: cookie session, JWT, something else? Self-host must stay login-free by
  default, so whatever is chosen has to have a credible "already authenticated, don't ask" mode.
- Where does `DISABLE_AUTH` / trusted-reverse-proxy mode intercept — at the route layer, or by
  supplying a synthetic session? ADR-0003 makes this a first-class requirement, not a flag bolted on.
- Does the **core** stay tenant-agnostic as ADR-0003 says (it transforms data handed to it), and if
  so where exactly is the boundary — server resolves the tenant, core never sees it?

## Why this is on the map

This is the gap the review found first: `AGENTS.md`'s "auth layer" checkpoint means *service
credentials* (`AuthProvider`, OAuth). **User accounts and login are a different thing with the same
name**, and nothing in the roadmap, the operating model, or `CONTEXT.md` owned them — despite
ADR-0003 pulling them into Phase 0–1 explicitly.

## A good resolution

- The entity model written down: what a tenant is, whether users exist separately, what a session is.
- New `CONTEXT.md` glossary terms so the two auths stop colliding in prose.
- Enough to let 002 design the schema and 006 decide where credentials hang.
- An ADR if the model is non-obvious — it almost certainly is.

---

## Resolution — 2026-08-03

Grilled with Cal. Full reasoning and the rejected alternatives are in
[ADR-0007](../../adr/0007-account-model-sessions-and-the-core-boundary.md); the answers to the four
questions above:

1. **No separate user entity. One `Account`, 1:1 with the data it owns, permanently.** One hosted
   subscription = exactly one login, forever — a shared household sync is not a case ultrasonics
   serves. No membership join, no seam held open on spec.
2. **Sessions are server-side rows** behind an opaque HTTP-only cookie. Not JWT: ultrasonics is a
   single server owning its own database, so stateless verification buys nothing while costing
   instant revocation.
3. **Auth is never bypassed, only sourced.** One middleware always resolves a `Session`, from one of
   three sources — cookie login, bootstrapped account, trusted-proxy header — *all available in every
   deployment*. Self-host defaults to the frictionless source; it is a default, not a ceiling.
   Route-guard no-ops under `DISABLE_AUTH` were rejected as a second code path.
4. **Core takes capabilities, never identity.** No core function accepts an `accountId`; the server
   hands it pre-scoped objects. Cross-account leakage becomes structurally impossible rather than a
   rule every query must remember.

**The term "tenant" is retired.** Cal did not recognise it — it was jargon an agent introduced when
writing up ADR-0003, not a concept Cal chose. The isolation decision underneath *was* Cal's and
stands; only the word changes. Everything scopes by `account_id`.

**Surfaced two follow-ups**, deliberately not settled here: how a hosted account authenticates
(ticket 010) and self-host first-run + auth-mode configuration (ticket 011).
