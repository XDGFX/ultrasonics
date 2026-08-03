# ADR-0009 — The v2 database: relational SQLite, Drizzle, and account scoping in the query layer

**Status:** Proposed
**Date:** 2026-08-03
**Refines:** ADR-0001 (names the "real ORM" it left unnamed), ADR-0003 and ADR-0007 (expresses the
account scope concretely), ADR-0008 (spends the schema it handed over)

## Context

ADR-0003 is explicit that the persistence layer is designed around the owner scope from the first
migration and that there is no later "add multi-tenancy" project. ADR-0007 named the entity —
`Account`, one-to-one with the data it owns — and ADR-0008 emptied `accounts` of credentials and
introduced `federated_identities`. What none of them decided is the database itself: engine, query
layer, the actual tables, how scoping is enforced, how credentials sit at rest, and how a
self-hoster's database moves forward on upgrade. Map ticket 002 exists to close that, and the
wayfinder review found no cell anywhere owned it.

One premise correction happened during the grilling and is recorded here because it changed an
answer. The draft argument for a weak self-host default leaned on a "no setup promise". No such
promise exists: every use of *frictionless* in ADR-0003, ADR-0007, ADR-0008 and `CONTEXT.md` is about
**login** specifically — "no login friction", "a login wall would be a regression against v1, which
had none". Cal flagged the over-reading directly: plenty of self-hosted software requires
configuration, and minimising friction *where reasonable* is not a prohibition on env vars. The
generalisation was an agent's paraphrase hardening into a constraint, the same failure mode ADR-0007
caught with the word "tenant".

## Decision

### 1. Relational, with JSON columns for the document-shaped payloads

Tables and foreign keys for the rigid parts; a JSON column where the shape legitimately varies
(applet definitions, per-plugin settings), validated by Zod rather than by the database.

MongoDB was genuinely considered — Cal's recent projects use it and prefer its object model. It was
rejected on a structural rather than aesthetic ground: **Mongo has no embedded single-file mode**, so
choosing it obliges every self-hoster to run and maintain a second process. Cal's position, recorded
as given: requiring that of self-hosters would not be unreasonable in itself, but there is no genuine
benefit on *either* tier here to pay for it. The object ergonomics that motivate Mongo arrive anyway
from Zod (ADR-0001) plus JSON columns.

The accepted cost: JSON column contents are opaque to the database — no constraints, no deep
indexing without extra work, and Zod is the only guard on that shape. For per-plugin settings, whose
shape varies per plugin by design, that is the correct trade.

### 2. SQLite now; the schema stays portable; no Postgres yet

SQLite is the only engine implemented. The schema stays inside the SQLite/Postgres intersection — no
dialect-exclusive column types — so a future client/server engine is a driver swap and a translation
rather than a redesign. Cal's call: *if SQLite will work for a while, let's not jump ahead trying to
host Postgres*, while not locking out the expansion.

The known ceiling, recorded so a future reader does not rediscover it under pressure: SQLite takes
one writer at a time and its file must live on a volume attached to a single container, so the app
cannot scale to multiple instances. For ultrasonics' workload — small writes, scheduled syncs,
hundreds to low thousands of accounts — that ceiling is distant, but it is the trigger for revisiting
this ADR.

**Consequence taken deliberately:** row-level security was the only "the database enforces scoping"
option and it is Postgres-only, so it is not available. Scoping is enforced in the query layer
(§4), by construction rather than by discipline.

### 3. Drizzle is the query layer, rejecting Prisma

Drizzle: schema declared as TypeScript, typed queries returning plain objects, runs natively on
`bun:sqlite` with no engine binary, and `drizzle-kit` generates **plain SQL migration files committed
to the repo**. `drizzle-zod` derives Zod schemas from the table definitions so the storage shape and
the validation shape cannot silently drift.

Prisma has the nicer developer experience and better tooling, and was rejected on two counts: a
separate `.prisma` schema DSL sitting outside TypeScript is a poor fit for a codebase whose stated
goal (ADR-0001) is autonomous agent development against strong types, and its heavier runtime plus
historical Bun friction is a real cost in a self-host container. Kysely was rejected as a query
builder with no schema modelling or migration generation; raw `bun:sqlite` as hand-written SQL
everywhere, which is precisely where a forgotten `WHERE account_id = ?` lives.

The accepted cost: Drizzle table declarations are dialect-specific (`sqliteTable` vs `pgTable`), so a
Postgres move means rewriting the declarations while the queries built on them largely survive. On a
schema this small that is a contained mechanical job, and it is the price of §2 rather than an
argument against it.

### 4. Scoping is enforced by a scoped store, with a separate narrow auth module

Two data-access modules, and the raw Drizzle connection is private to their directory:

- **The scoped store.** `storeFor(accountId)` returns an object whose every method has `account_id`
  pre-bound. Route handlers and core receive only this. Forgetting the scope stops being a mistake
  that can be expressed — the structural-impossibility property ADR-0007 established at the core
  boundary, extended one layer up into the server.
- **A narrow auth store.** `accounts`, `sessions` and `federated_identities` lookups by token or
  subject id, used *only* by the session middleware and the login routes. This path must exist
  because resolving a session is precisely the query that has no account yet.

The rejected alternative was one store with an `unscoped()` escape hatch, on the same reasoning
ADR-0008 used against skipping the auth middleware: a single door that is *sometimes* legitimate gets
used when someone is in a hurry, and the resulting bug is silent rather than loud. Two modules make
an auth-store import inside a feature route visible in review.

The store exposes **named methods** (`store.applets.list()`), not a scoped query builder. A builder's
surface is unbounded and unreviewable; named methods make every query that exists visible in one
file. Adding a method per query is mild friction accepted deliberately — loosening a narrow store
later is trivial, tightening a permissive one after a dozen routes depend on it is not.

**A lint rule from day one** forbids importing the raw connection outside the database directory.
Cal's standing preference, recorded because it generalises beyond this ADR: things that are supposed
to always be one way get a lint rule, CI check or test rather than a convention — and that is worth
more in a repo meant for autonomous agents than in a human-only one.

### 5. The initial migration

| Table | Scoped | Notes |
|---|---|---|
| `accounts` | — (is the scope) | `id`, `created_at`. No credential columns, ever (ADR-0008). Email deliberately absent — ticket 012 owns it. |
| `sessions` | `account_id` | `token_hash` (unique), `created_at`, `last_seen_at`, `expires_at` **nullable** |
| `federated_identities` | `account_id` | `provider`, `subject_id`, unique on `(provider, subject_id)` |
| `applets` | ✅ | `name`, `enabled`, `definition` (JSON — the plugin chain, Zod-validated), timestamps |
| `credentials` | ✅ | `service`, `expires_at`, `key_version`, `secret` (encrypted blob) — §6 |
| `plugin_settings` | ✅ | Per-account persistent plugin settings (JSON) |
| `instance_settings` | — (operator-owned) | Deployment-wide config; reached only through the narrow module |
| `runs` | ✅ | `applet_id`, started/finished, status, log |

**`plugin_settings` splits from `instance_settings`** because v1's single `plugins` table conflated
two different things that only a single-user deployment can conflate: the Spotify *application's*
client id and secret, registered once by whoever runs the instance and identical for every account,
versus this account's Plex URL and match threshold. One table with a nullable `account_id` was
rejected — a nullable scope column silently changes which rows a scoped query matches, which is the
exact failure §4 exists to prevent.

**Session tokens are stored hashed**, so a database leak does not hand over live sessions —
consistent with ADR-0008's "ultrasonics never stores a login credential".

**`runs` is net-new**; v1 had no run history at all, only log files. It is the only table that grows
without bound, so retention needs an answer before hosted carries real traffic — noted, not decided.

**Device metadata on `sessions` (user agent, IP) is deliberately deferred**, even though ADR-0007's
per-device logout will eventually want a label. `sessions` is the one table where a retrofit is free
because it can be truncated — everyone logs in again and nothing of value is lost. That is the exact
opposite of `accounts`, which is why ADR-0008 built `federated_identities` up front. IP is avoided
specifically: it is the only personal data in the schema not strictly needed.

`expires_at` is nullable and `NULL` means never expires — how self-host's bootstrapped session is
expressed (ADR-0007: "an ordinary session row that does not expire"). This is not in tension with
rejecting a nullable `account_id` above: a nullable scope column changes *which rows match* a query
silently, whereas a nullable expiry is one explicit branch at one call site.

**Sessions expire 30 days after last use**, rolled forward via `last_seen_at`, so an active user is
never logged out and an abandoned session dies in a month. Hosted only; self-host's row never
expires. Expired rows are swept on boot and periodically by the scheduler the app already runs,
rather than adding a cron dependency.

### 6. Credentials are always encrypted, and the key is an explicit choice

`credentials.secret` holds the credential document encrypted with AES-256-GCM, random nonce per row,
stored as `nonce ‖ ciphertext ‖ tag` (Bun's WebCrypto — no dependency). `expires_at` stays in the
clear so the scheduler can find credentials due for refresh without decrypting every row.
`key_version` costs one integer now and makes rotation possible later without a migration on a table
full of real user tokens.

Encryption is **always on in both deployments** — a "self-host stores plaintext" branch is a second
code path where the hosted encryption is only ever exercised in production, the failure class ADR-0003
set out to eliminate.

**The key is required and the app refuses to boot without an explicit decision:**

- `ENCRYPTION_KEY=<64 hex chars>` — the operator supplies it.
- `ENCRYPTION_KEY=auto` — generate on first run, store `0600` beside the database, accepting the
  limitation below.

Unset exits with a message explaining the difference and printing a freshly generated key ready to
paste, so the secure path is also the fast path.

Silent auto-generation was rejected, and the reason is not the key file itself: it is that the user
never learns the key exists, does not back it up, and discovers this the day they restore a backup
and every service connection is dead. Requiring the value costs one line in a compose file and
records in configuration which risk the operator chose.

**Stated plainly for whoever reads this next:** under `auto`, self-host encryption protects against a
leaked *database file* — pasted into a bug report, or caught by a backup job globbing `*.db` — and
**not** against a compromised host, because the key sits beside the database. That is a real threat
worth covering, and it is not the stronger guarantee the word "encrypted" tends to imply.

### 7. Migrations apply automatically on boot, after a file copy

Pending migrations run at startup, preceded by copying `ultrasonics.db` to `ultrasonics.db.pre-<version>`,
aborting the boot loudly on failure so the operator finds an intact database rather than a
half-migrated one.

An explicit operator-run command is right for a team with a deploy pipeline; for a homelab user
running `docker compose pull && up -d` it is a step that will not be taken, leaving the app refusing
to start or running against a stale schema. This is the "minimise friction where reasonable" case —
distinct from the over-read corrected in the Context above — and it is safe here precisely because §2
chose SQLite: the pre-migration backup is a file copy.

**Backup pruning and downgrade/rollback are out of Phase 0.** Accumulating `.pre-` files are a minor
disk annoyance; rollback needs a real answer not worth guessing before a single user is on v2.

## Consequences

- **Ticket 002 closes**, and Phase 0's schema gate has a concrete initial migration to build against.
- **The scoped store is a Phase 1 build item, not just a convention** — with the lint rule landing in
  the same wave, per §4.
- **Ticket 006 (`AuthProvider` surface) inherits the storage shape** it was waiting on: encrypted blob
  per `(account, service)`, `expires_at` in the clear. The *resolution interface* remains 006's call.
- **Ticket 011 (self-host first run) inherits a precedent**: explicit configuration over silent
  defaults, with the *login wall* remaining the one thing self-host genuinely never gets. 011 may
  adopt or reject it, but should do so knowingly.
- **The v1 importer's job is small.** v1's entire schema is three tables — `ultrasonics(key,value)`,
  `plugins`, `applets` — with Python `repr` blobs in the last two and no run history. The fog entry
  for the importer can be graduated with that in hand.
- **`CONTEXT.md`'s "frictionless" wording is tightened to "no login wall"**, so the over-reading
  corrected in the Context above is harder for the next reader to repeat.
- **Two triggers to revisit this ADR**, neither of which is a defect: SQLite's single-writer ceiling
  if hosted needs multiple app instances, and `runs` retention once hosted carries real traffic.
