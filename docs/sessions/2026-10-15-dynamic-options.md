# 2026-10-15 — Builder-time credentials for dynamic options (map ticket 007)

/ wayfinder, working the map. One ticket resolved.

## Done

**Ticket 007 — resolved: deferred past Phase 1**, agreed by Cal in session. No ADR: the deferral is
cheap to reverse, and ADR-0012 already says dynamic options must arrive as a separate hook.

- v1 had **one** dynamic option list: Plex's library sections, fetched in `builder()` on every
  configure-page load, in both `up_plex.py` and `up_plex beta.py`. It never had a playlist picker.
- Plex's v2 output gets an optional free-text `library` setting. Empty means the only music
  library. Otherwise it matches a title (ignoring case) or a bare section id. If it can't be
  resolved, the run fails `misconfigured` and lists the server's music libraries. It never falls
  back to all libraries.
- Pickers are wanted eventually, not before parity. They're now map fog with their known shape:
  an additive hook, a second `PluginExecutor` entry point, a builder context for `resolve()`, a
  credentials-missing rule, and caching.
- `legacy-architecture.md` now records the builder fetch on the Plex entry. Ticket 013 has a note
  about carrying `section_id` across.

## Next

Frontier, first by number: **009 — triage the v1 issue backlog** (task), then 011, 012 ⛔, 013, 015,
016.
