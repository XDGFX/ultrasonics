# Draft spec: the v1 importer

> Draft for grilling, not yet filed. Phase 2 (plugin parity). Builds on ADR-0017, which decided the
> importer's shape. Points marked **⚑** touch the auth layer, the plugin SDK contract, the database
> schema or multi-tenancy (AGENTS.md, checkpoint gates).

## Problem Statement

v1 users upgrade by changing their Docker image tag (ADR-0017, Context). Their `/config` volume
holds v1's `ultrasonics.db`, with every applet and every plugin setting stored as a Python `repr`
string. Without an importer, each user rebuilds every applet by hand, and that is the cost ADR-0017
exists to remove.

ADR-0017 fixed the importer's shape: automatic, once, at first boot, self-host only; a TypeScript
parser for the `repr` subset; a table of where each row lands; skip-and-report for anything it
cannot map; one transaction. It left three things to Phase 2:

- the code itself;
- each plugin's mapping, written in that plugin's cell (§5);
- the details ADR-0017 did not need to settle, such as how a v1 time trigger's float interval and
  `Months` unit become a v2 schedule.

Reading v1's source and v2's server for this draft turned up one problem ADR-0017 does not
mention, and it blocks the upgrade path outright (open question 1). In v1's image, `database.py`
writes `config/ultrasonics.db` relative to `WORKDIR /`, so the file sits at `/config/ultrasonics.db`.
v2's image sets `DATA_DIR=/config` and keeps its own database at `join(dataDir, "ultrasonics.db")`
(`packages/server/src/configuration.ts`). That is the same path. A v1 user who changes the tag
boots v2 against v1's file. Boot then runs v2's migrations on it (ADR-0009 §7), and the first
`CREATE TABLE applets` collides with v1's `applets` table. So the upgrade either fails at boot or
writes into the file ADR-0017 §1 promises never to change.

## Solution

A new package, `@ultrasonics/v1-import`, which the server calls once at boot, after migrations
and account creation and before the scheduler starts (ADR-0017 §1, ADR-0015 §3). It:

1. finds a v1 database at the default path or `V1_DATABASE`, and opens it read-only;
2. parses each `plugins` and `applets` blob with a parser for the `repr` subset (ADR-0017 §2);
3. resolves each component's v1 plugin name and version to a v2 plugin, through a table of mapping
   modules, one per plugin, kept inside this package (ADR-0017 §5);
4. writes the mapped applets (disabled), plugin settings, the Plex grant and the `v1_import`
   marker in one transaction (ADR-0017 §6);
5. writes a report to the boot log, to a file in the data directory, and to a notice in the UI
   that stays until dismissed (ADR-0017 §6).

This spec builds the framework, the trigger mappings and the Plex output mapping, since Plex's
output already exists. Every other plugin's mapping arrives with that plugin's Phase 2 cell, as one
module and one fixture test in this package.

## User Stories

**Upgrading**

1. As a v1 user, I want to change my image tag and restart, and find my applets in v2, so that I
   don't rebuild them by hand.
2. As a v1 user, I want my v1 database left exactly as it was, so that reverting the tag gives me
   v1 back (ADR-0017, Consequences).
3. As a v1 user on systemd or a bare-metal install, I want to point the importer at my v1 database
   with `V1_DATABASE`, so that a non-Docker layout still imports.
4. As a v1 user, I want imported applets disabled, so that nothing syncs until I've reconnected my
   services and checked each one (ADR-0017 §3).
5. As a v1 user, I want each applet to keep its name and the order of its plugins.
6. As a v1 user with a time trigger, I want it to become the applet's schedule, so that enabling
   the applet restores its timing (ADR-0017 §4).
7. As a v1 user with a webhook trigger, I want to be told it was dropped and why, so that I know to
   create a new v2 webhook (ADR-0017 §4).
8. As a v1 user of Plex, I want my server URL and token carried into a Plex connection, so that I
   don't paste them again (ADR-0017, Context).
9. As a v1 user of Spotify or Deezer, I want the report to tell me to reconnect, because my v1
   token was issued to the dead proxy's app (ADR-0017, Context).
10. As a v1 user of Last.fm, I want the report to tell me I need my own API key (ADR-0017 §6).
11. As a v1 user with an applet that uses a plugin v2 doesn't have (`system command`, the TIDAL
    fork, my own plugin), I want that applet skipped and listed with its v1 settings, so that I can
    rebuild it by hand (ADR-0017 §4).
12. As a v1 user with one corrupt applet, I want the others imported anyway (ADR-0017 §6).
13. As a v1 user, I want an imported setting that no longer fits its plugin to open in the form
    with the problem shown, rather than costing me the applet (ADR-0019 §7).
14. As a v1 user, I want the report shown in the UI until I dismiss it, written to a file I can
    keep, and printed in the boot log (ADR-0017 §6).
15. As a v1 user, I want the import to run once only, so that deleting an imported applet doesn't
    bring it back on the next restart (ADR-0017 §1).

**Safety**

16. As a v1 user, I want my v1 credentials kept out of the report and the boot log, so that a
    shared log doesn't leak my Plex token.
17. As a hosted-tier operator, I want the importer never to run, because v1 was never hosted
    (ADR-0017 §1).

**Maintainers**

18. As a plugin porter in Phase 2, I want to add my plugin's mapping as one module and one fixture
    test, without touching the SDK, so that my cell's v1 deliverable is small and checkable
    (ADR-0017 §5).
19. As a maintainer, I want the `repr` parser tested against the quoting corners `repr` produces,
    so that a v1 blob with an apostrophe or a non-ASCII title parses (ADR-0017 §2).
20. As a maintainer, I want the importer tested end to end against v1 fixture databases, offline.

## Implementation Decisions

### Package and boundaries

- A new package, `packages/v1-import`, named for its concept (ADR-0014 §1). Its `exports` field
  exposes one function the server calls at boot, and nothing else (ADR-0014 §2).
- It depends on `@ultrasonics/db`, `@ultrasonics/registry` (to know which v2 plugins exist and to
  read their schemas) and `@ultrasonics/plugin-sdk`. `@ultrasonics/server` depends on it. That adds
  no cycle to the package graph (ADR-0014 §4).
- Mappings are modules inside this package, never hooks on a plugin, so the frozen SDK stays
  untouched (ADR-0017 §5). **No SDK change.**

### Finding and recognising the v1 database ⚑ database schema

- The importer looks at `V1_DATABASE` if set, otherwise at the default path. Which default depends
  on open question 1.
- It opens the file read-only (`bun:sqlite` with `readonly: true`) and never writes to it
  (ADR-0017 §1).
- It recognises v1 by its three tables, `ultrasonics`, `plugins` and `applets`, with v1's columns.
  Anything else, including an unreadable file, aborts the import with an error in the boot log.
  The server still boots (ADR-0017 §6: "the whole import aborts").
- No v1 database found: no import, no marker, no report. A later boot that finds one still
  imports, which is the point of `V1_DATABASE`.

### When it runs ⚑ multi-tenancy

- Boot order: configuration, database copy and migrations, account creation, **import**,
  scheduler (ADR-0015 §3, ADR-0017 §1). The Plex grant needs `ENCRYPTION_KEY`, which is checked
  first.
- The importer skips itself when the `v1_import` marker exists (ADR-0017 §1).
- It writes to the one account self-host has (ADR-0015 §5: "Self-host has one account"). It
  refuses to run if the `accounts` table holds anything other than exactly one row, and logs why.
  That is a cheap guard for ADR-0017 §1's "the hosted tier never imports", since nothing in the
  server yet says "hosted" (open question 2).

### The `repr` parser (ADR-0017 §2)

- Parses exactly v1's subset: single- and double-quoted strings, `True`, `False`, `None`,
  integers, floats, lists and dicts. It throws on anything else, naming the offset.
- String escapes: `\\`, `\'`, `\"`, `\n`, `\r`, `\t`, `\xhh`, `\uhhhh` and `\Uhhhhhhhh`. `repr`
  picks double quotes when a string contains `'` and no `"`.
- Output is plain JSON values. Dict keys are always strings in v1's blobs; a non-string key
  throws.

### Reading the `plugins` table

v1 stores one `plugins` row per plugin and version ever seen, with `settings` NULL until the user
configured it. `version` is a `FLOAT` column, so `"0.5"` reads back as the number `0.5`.

- Versions are compared as strings after normalising the stored value with SQLite's text form.
  Every v1 official plugin's version is a short decimal (`0.1` to `1.0`), so the float column
  loses nothing for them.
- Each applet component carries its own `version`, and v1 looked up the persistent settings for
  that exact version (`plugins.py`). The importer does the same when a mapping needs persistent
  values for one component, such as Plex resolution in ADR-0017 §4.
- For the account-wide `plugin_settings` row, the importer takes the newest version whose
  `settings` is not NULL. Conflicts between versions are open question 4.

### Resolving a component to a v2 plugin

- A mapping module declares which v1 `(name, version)` pairs it accepts, and which v2 plugin they
  become. ADR-0017 §4's Plex rule is one example: `plex` 1.0 and `plex beta` 1.0 map to v2 `plex`,
  and so do `plex` 0.1 and `plex legacy` 0.1, which lose their path settings.
- A component no module accepts makes the whole applet **skipped and reported**, with its v1
  config (ADR-0017 §4). This covers `system command`, `rickroll` (a sample, not ported: roadmap
  Phase 2), third-party plugins, and any plugin whose Phase 2 cell hasn't landed yet.
- The importer does not read v1's `ultrasonics.version` row to resolve anything. v1 writes that row
  once, at first install, and never updates it (`database.py`: `Core.save()` only updates existing
  keys, and startup only warns on a mismatch). A 1.2.0 install first set up on 1.0 still says
  `1.0.0-rc.1`. Resolution therefore uses each component's own version. The row goes into the
  report as "first installed as", and nothing else. ADR-0017 §3 says the table is "read only to
  identify the v1 version", and this narrows that further.

### The mapping module

Internal to this package, not an SDK type:

- `accepts(name, version)`: whether this module maps that v1 plugin.
- `plugin`: the v2 plugin name it produces.
- `persistent(v1Settings)`: returns the v2 `plugin_settings` value, an optional grant
  `{ service, fields }`, and report notes. Optional.
- `instance(component, v1Data, v1Persistent)`: returns the v2 slot settings and report notes. A
  throw skips the applet and records the error (ADR-0017 §6).

Each module carries any state that changes behaviour, wherever the v2 plugin keeps an equivalent
(ADR-0017 §5).

A mapped value is **not** required to pass the v2 plugin's schema. The importer parses it with the
schema, and stores it whether or not it passes. Failures go into the report by field path. ADR-0019
§7 already covers this case: "After a plugin update or a v1 import, a stored value may fail its
schema. The form then opens with every value that still fits and shows the issues at once." Skipping
the applet instead would throw away a whole pipeline over one field the user can fix in a form.

### Where each row lands (ADR-0017 §3, as built)

- `ultrasonics` table: read for the report's "first installed as" line only. `api_url`,
  `trigger_poll`, `config_dir` and `new_install` are dropped without comment. A self-hosted
  `ultrasonics-api` URL may be private, so it is never printed (v1-issue-triage, findings on 013).
- `plugins` rows: through each module's `persistent()`.
- `applets` rows: one v2 applet per v1 applet, `enabled = false`, `name = applet_name`, slots in v1
  order, new v2 ids. `lastrun` is dropped and `runs` starts empty (ADR-0017 §3).
- An applet whose mapped definition has no input or no output fails `AppletDefinition`'s `min(1)`
  and is skipped and reported.
- On-disk files under v1's config directory are not read (ADR-0017 §3). That includes
  `up_spotify.bz2`, which is a pickle and must never be opened (ADR-0017 §2), the time trigger's
  `date_dict.db`, the local music database's `library.db` and local playlists' `backups/`.

### Triggers (ADR-0017 §4, ADR-0018 §1)

- **`time trigger`** (v1 0.2) holds `interval_input` (a float string), `update_frequency` (`Hours`,
  `Days`, `Weeks` or `Months`) and `start_timestamp` (`DD/MM/YYYY HH:MM`, or blank). A v2 schedule
  is `{ kind: "interval", unit: hour|day|week, count: int >= 1, anchor, timeZone }`. The conversion
  is open question 3.
- `next_run_at` stays NULL. The applet is disabled, and enabling it sets the next future slot
  without a catch-up run (ADR-0018 §4).
- **`webhook`** is dropped and reported (ADR-0017 §4). The report says that a v2 webhook needs a
  new secret.
- An applet left with no trigger is imported and runs on demand (ADR-0017 §4, ADR-0018 §2).
- More than one time trigger on one applet: v1 combined triggers with AND, which v2 dropped
  (ADR-0011 §3), and an applet has one schedule (ADR-0018 §2). The importer keeps the first and
  reports the rest.

### Credentials ⚑ auth layer

- Only Plex carries across (ADR-0017, Context). The Plex module returns a grant
  `{ serverUrl, token, verifyTls }` for service `plex`, which the importer encrypts with the
  current key and writes as one `credentials` row (ADR-0009 §6). `verifyTls` comes from legacy
  `plex`'s `check_ssl` where present, and is `true` otherwise.
- Two v1 Plex rows with different servers: the v1.0 plugin's credentials win, and the report names
  the applets that now point at that server (ADR-0017 §4).
- Spotify, spotify mixer and Deezer `auth` values are never written anywhere. The report lists the
  service as "reconnect".
- No credential value, from any plugin, appears in the report, the boot log or an error message.
  A skipped applet's printed v1 config comes from the `applets` blob, which holds no credentials
  in v1. The `plugins` row values are never printed.

### The Plex output mapping (built here, because Plex's output exists)

- `section_id` (`"Title [id]"`) → `library`, reduced to the bare id, as ticket 007 decided and
  #114 story 8 expects. A value without the `[id]` suffix is kept as written, since the plugin
  matches titles too.
- `existing_playlists` `Append`/`Update` → `existing` `append`/`update`.
- `fuzzy_ratio` is dropped without comment. v2 has no match threshold setting (#114, map decision
  #104), and ADR-0022 §5 accepts the behaviour change.
- `filter` belongs to the input. v1 `plex` inputs need the Plex input's cell (service-side
  drafts). Until it lands, an applet with a Plex input is skipped as unknown.
- Legacy `plex_prepend` and `ultrasonics_prepend` are dropped, and the report says so
  (ADR-0017 §4).

### The transaction and the marker ⚑ database schema (no migration)

- Everything the import writes, plus the marker, goes in one transaction (ADR-0017 §6).
- The marker is the `instance_settings` key `v1_import` (ADR-0017 §1). Its value is
  `{ importedAt, report, dismissed }`. The UI notice reads it, and dismissing sets `dismissed`.
  `instance_settings` is a key-value JSON table, so this needs **no migration**. It does need the
  importer to write account-scoped rows and an operator-owned row in one transaction, which
  ADR-0009 §4's scoped store doesn't offer yet. The importer gets a narrow write module in
  `@ultrasonics/db`, alongside `system` and `auth-store` (ADR-0028).

### The report (ADR-0017 §6)

- **Contents:** "first installed as"; applets imported (by name, with notes); applets skipped, each
  with its reason and its v1 config as indented JSON; services to reconnect; the Last.fm key to
  supply; dropped webhooks; schedule conversions that rounded; fields that failed their schema.
- **Where:** the boot log (a summary, plus the file's path), `<DATA_DIR>/v1-import-report.md`, and
  the UI notice.
- The file is plain Markdown so a user can read it without the app.

### The UI notice

- A banner on the applets page while `dismissed` is false. It shows the summary counts and links to
  the full report, served by one new read-only route, plus a dismiss route. It is the first notice
  of its kind. ADR-0017 §6: "A notice is not a notification channel, so this decides nothing about
  notifications."

## Testing Decisions

- A good test opens a v1 fixture database, runs the import into a fresh v2 database, and asserts on
  the rows written and the report. It never asserts on parser internals beyond the parser's own
  unit tests.
- **The `repr` parser** has its own table of cases: both quote styles, a string holding both
  quotes, `\x` and `\u` escapes, non-ASCII titles, nested lists and dicts, `True`/`False`/`None`,
  and things it must reject (a tuple, a set, `datetime(...)`).
- **Fixture databases** live in `packages/v1-import/test/fixtures/` (ADR-0014 §5). Each is built by
  the test from a `.sql` file of v1's `CREATE TABLE` statements and `INSERT`s whose blobs are
  `repr` strings, so the fixtures are readable in review. Source of truth is open question 5.
- **Cases:** a clean import; a second boot that does nothing; an unknown plugin; an unparseable
  blob; a mapping that throws; a mapped value that fails its schema and is stored anyway; Plex
  credentials encrypted; two Plex servers; Spotify listed to reconnect; a time trigger in each
  unit; a webhook dropped; an applet with no trigger; a not-v1 file aborting with the server still
  booting; `V1_DATABASE`; more than one account refusing to import.
- **Read-only:** the test hashes the fixture file before and after, and the hashes match.
- **No credential in the report:** a fixture with a recognisable token, and an assertion that it
  appears nowhere in the report, the log or the file.
- **Each plugin's mapping** has a fixture test in its own Phase 2 cell. That is the roadmap's
  Phase 2 exit gate ("every plugin's v1 import mapping tested against a v1 fixture").

## Out of Scope

- Every Phase 2 plugin's mapping except Plex's output. Each comes with its own cell (ADR-0017 §5).
- A CLI command or UI action to re-run the import (ADR-0017 §1).
- Reading v1's on-disk plugin files (ADR-0017 §3).
- Migrating settings between v2 plugin versions (ADR-0019 §7 leaves it undecided).
- Notifications (ADR-0017 §6).

## Open questions

Each has a recommendation. ⚑ marks a checkpoint.

1. **v1's database and v2's share a path.** ⚑ database schema. Under Docker both are
   `/config/ultrasonics.db`. Booting v2 on a v1 volume runs migrations on v1's file, which collides
   on `applets` and breaks ADR-0017 §1's "opens that file read-only and never changes it".
   - **Recommended:** rename v2's database file, for example `DATABASE_FILE = "ultrasonics-v2.db"`.
     No v2 user exists before Phase 4's release, so the rename costs nothing. v1's file stays where
     v1 expects it, rollback keeps working, and the importer's default path becomes
     `<DATA_DIR>/ultrasonics.db`.
   - Alternatives:
     - Move v1's file aside at boot (to `<DATA_DIR>/v1/`) before migrating. That changes v1's
       file, and a rolled-back v1 would start empty.
     - Tell v1 users to mount a new volume for v2 and set `V1_DATABASE`. That breaks "change the
       tag and restart".
   - Either way, boot must refuse to migrate a file that holds v1's three tables and no migration
     history, so this can't happen silently again.
2. **What stops the hosted tier importing?** ⚑ multi-tenancy. ADR-0017 §1 says it never imports,
   and nothing in the server yet says "hosted".
   - **Recommended:** run only when the `accounts` table holds exactly one row and `AUTH_SOURCE`
     is not `oauth`. Both are true of self-host by ADR-0015, and both are cheap.
   - Alternative: a deployment flag. There is none to hang it on until Phase 5.
3. **Converting a time trigger.** v1 allows a fractional count, months, and intervals under an
   hour. v2 has whole hours, days and weeks, with a minimum of one hour (ADR-0018 §1).
   - **Recommended:**
     - `Hours`, `Days`, `Weeks`: round `interval_input` to the nearest whole number, minimum 1.
     - `Months`: `day`, with count `round(n × 30.42)`, which is v1's own 2,628,000 seconds.
     - The anchor is `start_timestamp` read as a local time; if blank, the import time.
     - The zone is the process's `TZ` if set, else `UTC`. v1 ran in a container whose zone was UTC
       unless the user set `TZ`.
     - Any rounding, and the zone used, go in the report.
   - Alternatives: skip any applet whose interval doesn't convert exactly, which punishes users
     for v1's looser form; or store no schedule and report it, which loses timing for everyone on
     `Months`.
4. **Persistent settings that differ between v1 versions.** v1 kept settings per plugin version
   and copied them forward only within a major version. v2 keeps one `plugin_settings` row per
   plugin (ADR-0009 §5).
   - **Recommended:** the newest version with settings wins. The report notes any older version
     whose settings differ and which applets referenced it.
   - Alternative: the version the most applets reference. That is harder to explain.
5. **Where fixture blobs come from.** ADR-0022 §4 says no runnable v1 checkout is needed, so
   nobody can generate `repr` output by running v1.
   - **Recommended:** hand-written `.sql` fixtures checked against v1's `database.py` and
     `webapp.py`, plus one real v1 database from Cal's own install, if one exists, with secrets
     replaced.
   - Alternative: generate fixtures with a one-off Python script, run once and committed. That
     puts Python in a contributor's path once, not in the image (ADR-0017 §2 rejected it for the
     image only).
6. **Who owns the Spotify mapping?** The Spotify input was built in Phase 1, and its output is a
   Phase 2 cell on the service side. ADR-0017 §5 needs `created_playlists` carried "wherever the v2
   plugin keeps an equivalent", and that equivalent is the output's to define.
   - **Recommended:** the Spotify output cell writes the whole Spotify mapping, input and output.
     Until it lands, applets with a Spotify component are skipped as unknown, which only matters in
     development.
   - Alternative: this spec maps the input now and the output cell adds to it. That splits one
     plugin's mapping across two cells.

## Further Notes

- **Ordering.** The marker makes the import one-shot, so a development install that imports before
  every Phase 2 cell has landed skips those applets for good. No v1 user meets v2 before Phase 4.
  Developers delete the v2 database to redo it (ADR-0017 §1).
- **Decided here, worth a glance:**
  - Mapped values that fail their schema are imported, not skipped (ADR-0019 §7).
  - v1's `ultrasonics.version` row is reported, never used to resolve a plugin.
  - New v2 applet ids, not v1's uuid1 strings.
  - The report is Markdown at `<DATA_DIR>/v1-import-report.md`.
  - The importer refuses to run with more than one account.
- **Checkpoint summary.** The DB-file rename (open question 1) is a change to a built default.
  The narrow write module is new `@ultrasonics/db` surface with no migration. Writing the Plex
  grant touches the auth layer's storage but not its interface. No SDK change.

## Planned tickets

1. **The importer core.** Package, `repr` parser, v1 detection, read-only open, the hosted guard,
   resolution and the mapping table, the transaction and marker, the narrow DB module, triggers,
   the report file and boot-log summary. Blocked by open question 1's change to the database path.
   - [ ] The parser passes its case table, and rejects what's outside the subset.
   - [ ] A fixture import writes disabled applets with v1 names and slot order.
   - [ ] A second boot imports nothing.
   - [ ] An unknown plugin skips its applet, and the report holds its v1 config.
   - [ ] A not-v1 file aborts the import and the server still boots.
   - [ ] The fixture file's hash is unchanged after import.
   - [ ] Time triggers convert as open question 3 decides. Webhooks are dropped and reported.
   - [ ] No fixture credential appears in the report, the log or the file.
   - [ ] With two accounts, the importer logs why and does nothing.
2. **The Plex mapping and the Plex grant.**
   - [ ] `plex` 1.0, `plex beta` 1.0, `plex` 0.1 and `plex legacy` 0.1 all map to v2 `plex`.
   - [ ] The grant is encrypted, and decrypts to `{ serverUrl, token, verifyTls }`.
   - [ ] `"Music [3]"` becomes `library: "3"`.
   - [ ] Two servers: v1.0 wins, and the report names the affected applets.
   - [ ] Spotify and Deezer appear as "reconnect".
3. **The UI notice.** The read and dismiss routes, and the banner in `packages/web`.
   - [ ] The banner shows after an import with something to report, and stays across restarts.
   - [ ] Dismissing hides it for good.
   - [ ] `/verify`: boot the image on a fixture v1 volume, see the banner, open the report.
