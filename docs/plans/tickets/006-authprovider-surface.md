# 006 — AuthProvider surface freeze ⛔

**Status:** Open · **Type:** grilling · **Blocked by:** 001 · **Blocks:** 007 · **Claimed by:** —

## Question

What is the `AuthProvider` interface, concretely?

ADR-0005 decided the *abstraction* — a plugin declares what auth it needs; BYO / PKCE / Proxy
implementations decide how — and that credential storage is a checkpoint surface. It did not
specify a single type.

**This ticket has a prerequisite the review surfaced:** the Phase 0 exit gate requires freezing
`AuthProvider`, but unlike the SDK there was **no draft surface to freeze**. The SDK had
`plugin-sdk-v2.md`; `AuthProvider` had only an ADR. `../../proposals/auth-provider-v2.md` now
exists as the thing to grill — written as a starting point, explicitly not decided.

To settle:

- The `AuthSpec` shape a plugin declares (`defineAuth({ service, flow, scopes })`) and the flow
  vocabulary — is `pkce | oauth2 | apiKey | serverUrl | none` complete for the v1 plugin set?
- The `Credentials` shape handed to `run()`, and who refreshes an expired token — provider,
  runner, or plugin. v1 auto-renewed once inside the plugin on exception; v2 should not.
- Where BYO client IDs/secrets are entered and stored — per tenant, per plugin, both? Overlaps 002.
- The setup-wizard contract: what a provider must expose so the UI can walk a self-hoster through
  registering their own app.
- What `Proxy` needs reserved now so Phase 5 is additive, without building any of it.

## A good resolution

- The frozen interface in `auth-provider-v2.md`, status moved off `Draft`.
- The BYO and PKCE paths fully specified; `Proxy` a named seam only.
- Consistency with 002 on where credentials physically live.
