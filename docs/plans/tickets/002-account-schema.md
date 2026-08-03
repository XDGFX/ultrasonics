# 002 — Account-scoped database schema ⛔

**Status:** Open · **Type:** grilling · **Blocked by:** 001 ✅, 010 ✅ · **Blocks:** — · **Claimed by:** —

## Question

What is the v2 database schema, and how are migrations run?

ADR-0003: *"The persistence layer is designed around a [n owner] context from the first migration;
there is no later 'add multi-tenancy' project."* That makes this the single most expensive thing on
the map to get wrong, and the review found **no cell anywhere owned it** — Phase 0's gate did not
mention it and Phase 1 mentioned only the v1 importer.

[ADR-0007](../../adr/0007-account-model-sessions-and-the-core-boundary.md) settled the entity model
this schema expresses, so the starting point is fixed: an `accounts` table, a `sessions` table, and
an `account_id` column on every owned row. **"Tenant" is retired — everything scopes by `account_id`.**
What columns `accounts` itself carries depended on ticket 010, now closed.

> **Unblocked 2026-08-03 by [ADR-0008](../../adr/0008-hosted-authentication-social-oauth.md).**
> Hosted authenticates by **social OAuth only**, so the answer is that `accounts` carries **no
> credential columns at all** — no `password_hash`, in any deployment mode, ever. Identities live in
> their own table:
>
> ```
> accounts              — no credential columns
> sessions              — server-side rows (ADR-0007)
> federated_identities  — (account_id, provider, subject_id), unique on (provider, subject_id)
> ```
>
> `federated_identities` is 1:many by construction even though launch ships Google alone and one
> identity per account — more providers are wanted early, and the alternative is a migration on the
> account table ADR-0003 says must never need one. Whether provider *email* is stored there is
> deliberately still open; it is a mutable key and ticket 012 owns that call.

To decide:

- **Tables and account scoping.** Applets, plugin persistent settings, credentials, run history,
  accounts, sessions. Which carry `account_id`, and is scoping enforced by convention, by a query
  helper, or by row-level security? ADR-0007 puts the boundary at the server layer — core is handed
  pre-scoped objects — so the enforcement mechanism should make that boundary hard to cross by
  accident.
- **ORM / query layer.** ADR-0001 says "a real ORM" replacing v1's `repr` + `ast.literal_eval`, but
  names none. Drizzle, Prisma, Kysely, raw `bun:sqlite`? Bun-native matters here.
- **Engine.** SQLite for self-host is a given; does hosted use the same schema on Postgres, and does
  that constrain the ORM choice and the JSON-column strategy?
- **Migrations.** Tooling, and how a self-hoster's database migrates on upgrade without them
  thinking about it.
- **Credential storage at rest** — encrypted? With what key, supplied how in self-host? This overlaps
  006; decide the storage shape here, the resolution interface there.
- **Session rows.** ADR-0007 chose server-side sessions: expiry, cleanup of dead rows, and the
  non-expiring row self-host's frictionless mode relies on.

## A good resolution

- The initial migration's tables and columns, written down.
- ORM + engine choice with the alternative it rejected named (house style).
- The migration story for an existing self-hoster.
- An ADR — this is squarely checkpoint territory and future agents will need the "why".
