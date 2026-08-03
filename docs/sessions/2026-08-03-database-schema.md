# Session — 2026-08-03 — Map ticket 002: the account-scoped database schema

Participants: Cal + Claude (Opus 5). Branch: `revival`. Ticket:
[002](../plans/tickets/002-account-schema.md) ⛔ · ADR:
[0009](../adr/0009-database-schema-drizzle-sqlite-and-migrations.md)

## What happened

Worked the map's highest-value frontier ticket — the one ADR-0003 calls the thing that must never
need retrofitting, and that the wayfinder review found no cell owned. Seven questions, resolved in
dependency order: model → engine → query layer → scoping enforcement → tables → credentials at rest →
migrations → sessions.

Grounding done before asking anything: v1's entire schema is **three tables** (`ultrasonics(key,value)`,
`plugins`, `applets`), with Python `repr` blobs in the last two and **no run history at all**. Very
little legacy shape constrains v2, and the importer's job is smaller than assumed.

## Decisions taken

1. **Relational with JSON columns**, not a document database. MongoDB was genuinely live — Cal's
   current projects use it and prefer the object model — and lost on a structural point: no embedded
   single-file mode, so it obliges every self-hoster to run a second process. Cal's ruling as given:
   asking that of self-hosters isn't unreasonable, but *without genuine benefit on either tier it's
   pointless*. Zod + JSON columns supply the object ergonomics regardless.
2. **SQLite only, schema kept dialect-portable.** No Postgres now; nothing dialect-exclusive, so it
   stays a near-drop-in later. Ceiling recorded: one writer, one container, no horizontal scaling.
3. **Drizzle**, rejecting Prisma — decided on committed plain-SQL migrations and no engine binary in
   the self-host container, not on query ergonomics, where Prisma is better.
4. **Scoping enforced in the query layer** (row-level security was Postgres-only, so never on the
   table). `storeFor(accountId)` with named methods; a *separate* narrow auth store for the pre-auth
   lookups that structurally cannot be scoped; raw connection module-private behind a **lint rule
   from day one**.
5. **Eight tables.** The structural change against v1: its single `plugins` table splits into
   account-scoped `plugin_settings` and operator-owned `instance_settings` — v1 could conflate "the
   Spotify app's client secret" with "this user's Plex URL" only by having one user. Session tokens
   hashed; device metadata deferred; `runs` frozen in Phase 0, retention noted not decided.
6. **Credentials always encrypted**, both deployments. `ENCRYPTION_KEY` **required**, with `auto` as
   an explicit opt-in to generation.
7. **Migrations auto-apply on boot** after copying the SQLite file, aborting loudly on failure.

## The premise Cal corrected

The draft argument for silently auto-generating the self-host encryption key rested on self-host
having a **"no setup promise"**. Cal challenged it — *who said that? Lots of self-hosted apps require
setup or env variables* — and the docs back Cal: every use of *frictionless* in ADR-0003, 0007, 0008
and `CONTEXT.md` is about the **login wall specifically**. Nothing anywhere promises no configuration.

An agent's paraphrase had hardened into a constraint and was about to justify a weaker security
default — the same failure mode ADR-0007 caught with the word "tenant", and the second time it has
happened in this planning effort. Worth noticing as a pattern rather than an incident.

With the premise removed, Cal's option was better than the recommendation: the flaw in silent
generation was never the key file, it was that the user never learns the key exists and discovers it
when a restored backup has dead service connections. `CONTEXT.md` now carries an explicit _Avoid_
against the wider reading, and ticket 011 is told not to re-derive it.

## Artifacts produced

- **`docs/adr/0009-…`** — new, `Proposed`. The full schema, query layer, scoping mechanism,
  encryption and migration decisions with rejected alternatives named.
- **`docs/plans/tickets/002`** — resolution appended, closed.
- **`docs/plans/tickets/013`** — new, graduated from the fog: the v1 importer's shape, now
  specifiable because both v1's three tables and the target schema are fixed.
- **`docs/plans/map.md`** — 002 in Decisions-so-far, importer fog cleared, 013 on the frontier.
- **Tickets 006 and 011** — told what they inherit (credential storage shape; the
  explicit-configuration precedent, to adopt or reject knowingly).
- **`CONTEXT.md`** — "frictionless" tightened to "no login wall".

## State

Still **documentation only** — no code. Phase 0's most expensive contract is now frozen.

## Next concrete steps

1. **Wave 0.0 is still unfiled** — Spotify extended quota and Apple Developer applications, queued
   since 2026-07-28. Lead time is the one thing engineering speed cannot compress. This has now been
   carried forward across three sessions.
2. Take **006** (`AuthProvider` surface) — it just gained its storage half and is the last ⛔ freeze
   Phase 0's gate needs beyond the SDK.
3. **003** (plugin isolation, research) and **009** (issue triage, task) remain AFK and unclaimed —
   they can run in parallel without a HITL session.

## Open questions carried forward

Two revisit triggers on ADR-0009, neither a defect: SQLite's single-writer ceiling if hosted ever
needs multiple app instances, and `runs` retention once hosted carries real traffic. Both are
deliberately not on the map — neither blocks freezing a Phase 0 contract.
