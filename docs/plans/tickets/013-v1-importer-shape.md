# 013 — The v1 importer's shape

**Status:** Open · **Type:** grilling · **Blocked by:** 002 ✅ · **Blocks:** — · **Claimed by:** —

## Question

When an existing v1 user upgrades, what exactly comes across from their old SQLite database, and
what happens to the parts that cannot?

Graduated from the map's **Not yet specified** on 2026-08-03 by
[ADR-0009](../../adr/0009-database-schema-drizzle-sqlite-and-migrations.md), which fixed the target
schema. Both sides are now known, so the mapping is a decision rather than fog.

**What v1 actually has** (`docs/reference/legacy-architecture.md`, `ultrasonics/database.py`) — three
tables, and nothing else:

```
ultrasonics (key, value)                        -- globals, incl. version
plugins     (id, plugin, version, settings)     -- settings is a Python repr blob
applets     (id, lastrun, data)                 -- data is a Python repr blob
```

No run history — v1 logged to files. So `runs` starts empty and the importer never touches it.

**What it maps onto** (ADR-0009 §5): `applets`, `plugin_settings`, `instance_settings`,
`credentials` — all account-scoped except `instance_settings`.

To decide:

- **Which account owns the imported rows.** Self-host's bootstrapped account is the obvious answer,
  but that ties the importer to first-run bootstrap (ticket 011) — decide whether import is a
  first-run step, or a later action taken by an already-logged-in account.
- **Parsing the `repr` blobs.** Python `repr` is not JSON; `ast.literal_eval` has no direct TS
  equivalent. Write a small parser, shell out, or require the user to run a v1-side export script?
  This is the one genuinely fiddly piece of work in the importer.
- **v1's `plugins` rows now split two ways** (ADR-0009 §5) — operator-level application credentials
  versus this account's settings. v1 stored them in one table, so the importer must decide per
  plugin which side each setting falls on. That mapping has to be written down somewhere; a table in
  this ticket is probably enough.
- **Applets referencing dropped plugins.** `system-command` is out of scope permanently, and Phase 2
  ports plugins gradually — so an import will routinely reference plugins that do not exist yet.
  Skip the applet, import it disabled with a warning, or refuse the whole import? Importing disabled
  seems kindest, but it needs the applet schema to tolerate an unresolvable plugin reference, which
  is a constraint on ticket 005's SDK surface if decided that way.
- **Service credentials.** v1 stored them in plugin settings in the clear; v2 encrypts them
  (ADR-0009 §6). Are they carried across and encrypted on the way in, or is the user asked to
  reconnect each service? Carrying them across is friendlier; asking is safer and may be forced
  anyway if v1's stored tokens have expired.
- **Idempotency.** Can the import be run twice, and what happens if it is?

## A good resolution

- A table: every v1 row type → where it lands, or why it does not.
- The `repr` parsing approach chosen, with its cost acknowledged.
- The dropped-plugin behaviour, and any constraint it imposes on ticket 005.
- Whether import is a first-run step or an anytime action — coordinated with ticket 011.
