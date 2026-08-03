# 002 — Account-scoped database schema ⛔

**Status:** ✅ Closed 2026-08-03 · **Type:** grilling · **Blocked by:** 001 ✅, 010 ✅ · **Blocks:** — · **Claimed by:** Cal (wayfinder session 2026-08-03)

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

## Resolution

**Decided 2026-08-03** with Cal, over seven questions. Full reasoning in
[ADR-0009](../../adr/0009-database-schema-drizzle-sqlite-and-migrations.md); the gist:

1. **Relational with JSON columns**, not a document database. MongoDB was a live option — Cal's
   recent projects use it and prefer its object model — and was rejected structurally rather than
   aesthetically: Mongo has no embedded single-file mode, so it obliges every self-hoster to run a
   second process. Cal's position as given: *asking self-hosters to run Mongo isn't unreasonable, but
   without genuine benefit on either tier it's pointless.* Zod plus JSON columns supplies the object
   ergonomics anyway.
2. **SQLite only, schema kept dialect-portable.** No Postgres now — *if SQLite will work for a while,
   let's not jump ahead* — but nothing dialect-exclusive, so the door stays open. Recorded ceiling:
   one writer, one container, no horizontal scaling.
3. **Drizzle**, rejecting Prisma. Deciding factor was the migration story plus Bun-native operation
   with no engine binary in the self-host container, not query ergonomics — where Prisma is better.
4. **Scoping enforced in the query layer**, since row-level security was Postgres-only and therefore
   never available. A `storeFor(accountId)` scoped store with named methods for everything owned, and
   a *separate narrow* auth store for the pre-authentication lookups that structurally cannot be
   scoped. Raw connection module-private, **enforced by a lint rule from day one** — Cal is for
   machine-checked invariants over conventions.
5. **The initial migration** is the eight tables in ADR-0009 §5. The one structural change against
   v1: its single `plugins` table splits into account-scoped `plugin_settings` and operator-owned
   `instance_settings`, because v1 could conflate "the Spotify app's client secret" with "this user's
   Plex URL" only by having one user. Session tokens hashed; device metadata deferred (uniquely
   cheap to retrofit — `sessions` can be truncated); `runs` frozen in Phase 0 with retention noted
   and not decided.
6. **Credentials always encrypted**, both deployments, AES-256-GCM per row, `expires_at` in the clear
   for the refresh scheduler, `key_version` for later rotation. `ENCRYPTION_KEY` is **required**, with
   the literal value `auto` as an explicit opt-in to generation.
7. **Migrations auto-apply on boot** after copying the SQLite file, aborting loudly on failure.
   Pruning and rollback out of Phase 0.

**A premise was corrected mid-ticket, and it changed the answer to 6.** The draft argument for silent
key auto-generation rested on self-host having a "no setup promise". Cal challenged it directly and
was right: every use of *frictionless* in ADR-0003/0007/0008 and `CONTEXT.md` is about **login**
specifically, and nothing anywhere promises no configuration. An agent's paraphrase had hardened into
a constraint — the same failure mode ADR-0007 caught with "tenant". With it removed, requiring an
explicit key choice is clearly better: the flaw in silent generation was never the key file, it was
that the user never learns the key exists and finds out when a restored backup has dead service
connections. `CONTEXT.md` is tightened to "no login wall" so the next reader cannot repeat the
over-reading.

**Consequences for the map:**

- **006 gets its storage shape** — encrypted blob per `(account, service)`, expiry in the clear. The
  resolution *interface* stays 006's call.
- **011 inherits a precedent**, to adopt or reject knowingly: explicit configuration over silent
  defaults, with the login wall still the one thing self-host never gets.
- **The v1 importer fog can graduate** — v1 is three tables, `repr` blobs in two, no run history, so
  the importer's scope is now knowable.
- **Two revisit triggers recorded, neither a defect:** SQLite's single-writer ceiling if hosted ever
  needs multiple instances, and `runs` retention once hosted carries real traffic.
