# 006 — AuthProvider surface freeze ⛔

**Status:** Open · **Type:** grilling · **Blocked by:** 001 ✅ (cleared) · **Blocks:** 007 · **Claimed by:** —

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
- Where BYO client IDs/secrets are entered and stored — per account, per plugin, both? **002 has now
  answered the storage half** (see the note below); what remains here is the resolution interface.
- **How the provider is handed to core.** ADR-0007 settled that core receives *capabilities, never
  identity*: the server builds an `AuthProvider` already bound to one account and passes it in, so no
  method on this interface should take an `accountId`. Scoping happens at construction. (The draft in
  `auth-provider-v2.md` still threads a `TenantContext` through every call — that is now wrong and
  the grilling should replace it.)
- The setup-wizard contract: what a provider must expose so the UI can walk a self-hoster through
  registering their own app.
- What `Proxy` needs reserved now so Phase 5 is additive, without building any of it.

> **Storage settled 2026-08-03 by [ADR-0009](../../adr/0009-database-schema-drizzle-sqlite-and-migrations.md)**
> (map ticket 002). Credentials live in a `credentials` table, one encrypted row per
> `(account_id, service)`: `secret` is the credential document under AES-256-GCM, `expires_at` and
> `key_version` sit in the clear so the refresh scheduler can find due rows without decrypting them.
> The server builds the provider already bound to one account, so **no method here takes an
> `account_id`** — it is bound at construction, and the raw connection is unreachable outside the db
> module anyway.
>
> Two things this hands the grilling rather than decides:
> - **Who refreshes.** `expires_at` being queryable in the clear makes a *scheduler-driven* refresh
>   cheap to implement — that is an argument available to this ticket, not a decision it has to take.
> - **Operator-level vs account-level BYO.** ADR-0009 §5 split v1's single settings table into
>   account-scoped `plugin_settings` and operator-owned `instance_settings`. A BYO client id/secret
>   registered once by whoever runs the instance belongs in the latter; one supplied by an individual
>   account belongs in the former. If this ticket concludes both paths are needed, both tables already
>   exist — no migration.

## A good resolution

- The frozen interface in `auth-provider-v2.md`, status moved off `Draft`.
- The BYO and PKCE paths fully specified; `Proxy` a named seam only.
- Consistency with 002 on where credentials physically live.
