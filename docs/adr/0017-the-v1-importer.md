# ADR-0017 — The v1 importer

**Status:** Accepted
**Date:** 2026-10-15
**Builds on:** ADR-0009 §5–§7 (target schema, encryption, boot migrations), ADR-0011 (triggers are
server config), ADR-0013 §7 (operator-level client credentials), ADR-0015 §3 (boot order)
**Amends:** `roadmap.md` Phase 2's exit gate: a ported plugin also ships its tested v1 mapping.
**Ticket:** [The v1 importer's shape](https://github.com/XDGFX/ultrasonics/issues/83)

## Context

v1 users upgrade by changing their Docker image tag. Their volume still holds v1's
`config/ultrasonics.db`, with three tables (`ultrasonics`, `plugins`, `applets`), and every blob in
them is a Python `repr` written with `str(dict)` and read back with `ast.literal_eval`. Rebuilding
every applet by hand is the upgrade cost the importer exists to remove.

Three facts from v1's code (`master` and `1.2.0`; `database.py` is identical in both) shape the
decision:

- **Blob values are strings, booleans and `None`.** Every value comes from an HTML form, apart from
  `lastrun`'s boolean. There are no tuples, sets, dates or bytes.
- **Most v1 credentials cannot work in v2.** Spotify's `refresh_token` and Deezer's token were issued
  to ultrasonics-api's developer app, the dead proxy. A refresh token only works for the app that
  issued it, and v2 uses the operator's own app (ADR-0013 §7). v1 never held a Last.fm key at all.
  Plex's `server_url`, `plex_token` and `check_ssl` are the only credentials that carry across.
- **A plugin's name is not its identity.** In 1.2.0, `plex beta` (v1.0) was renamed `plex`, and the
  old `plex` (v0.1) became `plex legacy`. So `plex` means a different plugin depending on which v1
  wrote the row.

## Decision

### 1. Automatic, once, at first boot, self-host only

The import runs at boot after migration and account creation (ADR-0015 §3), and before the scheduler
starts. That order matters because writing the Plex grant needs `ENCRYPTION_KEY`.

- It looks for `config/ultrasonics.db`, or the path in `V1_DATABASE`, and recognises a v1 database
  by its three tables.
- It opens that file read-only and never changes it.
- It writes a `v1_import` marker in `instance_settings`, and never runs again once the marker exists,
  even if every applet is later deleted. To redo an import, delete the v2 database.
- There is no CLI command and no UI action. The hosted tier never imports, because v1 was never
  hosted.

### 2. A TypeScript parser for the `repr` subset

The importer parses exactly the Python literal subset v1 can write: quoted strings with escapes,
`True`, `False`, `None`, numbers, lists and dicts. It throws on anything else. The parser is tested
against fixture blobs, which cover `repr`'s quoting corners: it switches to double quotes when a
string contains `'`, and it uses `\x` and `\u` escapes.

The alternatives were rejected. Shelling out to Python would put Python in the image for a single
run. A v1-side export script would make users run old code, and would break §1's automatic upgrade.
The Spotify access-token cache, a bz2-compressed pickle on disk, is never opened, because unpickling
an arbitrary file is a code-execution risk and the file holds nothing worth having.

### 3. Where each row lands

| v1 | v2 |
|---|---|
| `ultrasonics` table | Read only to identify the v1 version. Not imported: `api_url` is dropped without complaint, `trigger_poll` has no v2 meaning, and `config_dir` and `new_install` are v1 internals. |
| `plugins` row, credential keys | A grant (`credentials`), encrypted on the way in. Only Plex qualifies: `{serverUrl, token, verifyTls}`. Spotify and Deezer are reported as needing a reconnect. |
| `plugins` row, other global keys | `plugin_settings`, through the plugin's mapping (§5). |
| `applets` row | `applets`, imported **disabled**, with `applet_name` as its `name`. |
| An applet's per-instance `data` | The applet `definition`, through each plugin's mapping (§5). |
| `lastrun` | Dropped. `runs` starts empty. |
| On-disk files (`up_spotify.bz2`, the time trigger's `date_dict.db`, the local music database's SQLite file) | Not read. |

Nothing lands in operator-level `instance_settings` except the marker, because every v1 client id
and secret lived in the proxy.

### 4. Plugins the importer cannot map

- **Unknown plugin** (`system-command`, the TIDAL fork, self-written plugins): the whole applet is
  skipped and reported, with its v1 config, so the user can rebuild it by hand. Importing the applet
  without the missing component was rejected, because it silently changes what the applet does.
  Importing it disabled with a dangling reference was rejected too, because the applet schema would
  then have to tolerate an unresolvable plugin.
- **Plex** is resolved by name and version. `plex` v1.0 and `plex beta` v1.0 map to v2 `plex`, and
  so do `plex` v0.1 and `plex legacy` v0.1, which lose their path-prepend settings. The library id
  is taken from `section_id` (`"Title [id]"`), as ticket 007 decided. If two v1 Plex rows hold
  different servers, the v1.0 plugin's credentials win, because there is one grant per service, and
  the report says which applets now point at that server.
- **Trigger plugins** map onto ADR-0011's server config instead of being treated as unknown.
  `time trigger` becomes the applet's schedule, starting fresh from the import. `webhook` is dropped
  and reported: it has been broken since March 2022, and a v2 webhook needs a new secret anyway. An
  applet left with no trigger is still imported and can be run manually.

### 5. Each plugin's mapping is part of its port

A plugin's v2 settings do not exist until it is ported, so this ADR fixes only the general rule.
Each plugin's v1 mapping is written in its Phase 2 cell, as a module inside the importer and not as a
hook on the plugin, so the frozen SDK (ADR-0012) stays untouched. A port is not done until its
mapping is tested against a v1 fixture. A mapping must carry state that changes behaviour, such as
Spotify's and Deezer's `created_playlists`, wherever the v2 plugin keeps an equivalent. Otherwise
the first v2 run could create duplicate playlists.

### 6. Failure and the report

- **A bad applet is skipped and reported.** That covers a blob that will not parse and a mapping
  that throws.
- **The whole import aborts** only when the file is not a v1 database, or cannot be read.
- **Everything else is one transaction,** written together with the marker.

The report lists skipped applets with their v1 config, services to reconnect, the Last.fm API key
the user needs to supply, and dropped webhooks. It goes to the boot log, to a persisted UI notice
shown until the user dismisses it, and to a file in the data directory. A notice is not a
notification channel, so this decides nothing about notifications.

## Consequences

- **The upgrade is "change the tag and restart",** and nothing syncs until the user has reconnected
  services and enabled each applet.
- **Phase 2 cells carry one more deliverable,** the v1 mapping and its fixture test. That cost is
  spread across the ports instead of landing as one large importer cell at the end.
- **Most users reconnect Spotify.** That was forced by the proxy's death, not chosen here.
- **v1's file is never touched,** so a user can roll back to v1 by reverting the image tag.
- **There is no partial re-import.** A user who wants a skipped applet back rebuilds it by hand, from
  the report.
