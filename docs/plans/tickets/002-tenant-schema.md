# 002 — Tenant-scoped database schema ⛔

**Status:** Open · **Type:** grilling · **Blocked by:** 001 · **Blocks:** — · **Claimed by:** —

## Question

What is the v2 database schema, and how are migrations run?

ADR-0003: *"The persistence layer is designed around a tenant context from the first migration;
there is no later 'add multi-tenancy' project."* That makes this the single most expensive thing on
the map to get wrong, and the review found **no cell anywhere owned it** — Phase 0's gate did not
mention it and Phase 1 mentioned only the v1 importer.

To decide:

- **Tables and tenant scoping.** Applets, plugin persistent settings, credentials, run history,
  accounts. Which carry a tenant column, and is scoping enforced by convention, by a query helper,
  or by row-level security?
- **ORM / query layer.** ADR-0001 says "a real ORM" replacing v1's `repr` + `ast.literal_eval`, but
  names none. Drizzle, Prisma, Kysely, raw `bun:sqlite`? Bun-native matters here.
- **Engine.** SQLite for self-host is a given; does hosted use the same schema on Postgres, and does
  that constrain the ORM choice and the JSON-column strategy?
- **Migrations.** Tooling, and how a self-hoster's database migrates on upgrade without them
  thinking about it.
- **Credential storage at rest** — encrypted? With what key, supplied how in self-host? This overlaps
  006; decide the storage shape here, the resolution interface there.

## A good resolution

- The initial migration's tables and columns, written down.
- ORM + engine choice with the alternative it rejected named (house style).
- The migration story for an existing self-hoster.
- An ADR — this is squarely checkpoint territory and future agents will need the "why".
