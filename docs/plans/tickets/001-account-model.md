# 001 — Account and tenant model ⛔

**Status:** Open · **Type:** grilling · **Blocked by:** — · **Blocks:** 002, 006 · **Claimed by:** —

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
