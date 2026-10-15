# 007 — Builder-time credentials for dynamic options

**Status:** ✅ resolved 2026-10-15 (agreed by Cal in session) · **Type:** grilling ·
**Blocked by:** ~~005 ✅~~, ~~006 ✅~~ · **Blocks:** — · **Claimed by:** Cal (wayfinder session, 2026-10-15)

> **Unblocked 2026-08-06.** Both prerequisites narrowed this ticket rather than merely clearing it.
> [ADR-0012](../../adr/0012-plugin-sdk-surface-keyed-by-component.md) made `instanceSettings` a
> **static** record, so dynamic option fetching may not return it to a function — form generation now
> depends on it being static. [ADR-0013](../../adr/0013-authprovider-surface-service-grants-and-declared-fields.md)
> fixed `ctx.auth.get()` as a **zero-argument** typed getter, so builder-time credential access must
> not widen it. `up_plex.py`'s build-time HTTP fetch for library sections is the one v1 behaviour
> that actually needs this.

## Question

How does a plugin fetch **dynamic option lists** while an applet is still being built — "pick from
your Spotify playlists" — when the credentials it needs are resolved by an `AuthProvider` that so
far only serves `run()`?

From `plugin-sdk-v2.md`'s open questions. It sits at the join of two contracts, which is why it
waits for both: the SDK decides whether dynamic options are a `dynamicOptions()` hook or a
context-function schema (005), and `AuthProvider` decides whether credentials can be resolved
outside a run at all (006).

Specifics:

- Does the `AuthProvider` expose a resolve path for a **builder** context, not just a run context?
- What happens when the user has not yet supplied credentials — does the form degrade to free text,
  or block until the plugin's `test()` passes?
- Is the fetch server-side (the server calls the plugin) or does the SPA call an endpoint that
  proxies into the plugin? Isolation (003) may constrain this.
- Caching and rate limits — v1 re-queried on every builder render.

## A good resolution

- The builder-time credential path specified in whichever of the two proposals owns it.
- A clear answer for the credentials-missing case, since that is the first-run experience.
- If this proves bigger than expected, it is legitimate to defer it past Phase 1 with static
  settings only — say so explicitly rather than leaving it half-decided.

## Answer

**Deferred past Phase 1, explicitly.** Phase 1 ships static settings only; `instanceSettings` stays
the static record ADR-0012 froze. No ADR: the deferral is cheap to reverse, and ADR-0012 already
fixes that dynamic options arrive as a separate hook.

### Why deferral is safe

- **v1 had exactly one dynamic option list** — Plex's music library sections, fetched in
  `builder()` on every configure-page load, uncached, with no fallback if the fetch failed. Both
  `up_plex.py` and `up_plex beta.py` do it. Every other v1 builder is free text (`playlist_title`,
  regex `filter`, `dir`) or hard-coded choices. **v1 never had a playlist picker**; the ticket's
  "pick from your Spotify playlists" example has no precedent to lose.
- **The hook is additive.** An optional `options` declaration keyed by component and field leaves
  plugins that omit it untouched, so adding it later breaks nothing.
- **Building it now costs four new pieces for one field:** a second `PluginExecutor` entry point
  (ADR-0010 has `run` only), a builder context for `resolve()` (ADR-0013 describes it as credentials
  for a run), a credentials-missing rule, and caching.

Cal's stance on pickers: wanted eventually as a v2 improvement over regex fields, not before parity.

### What Plex does instead

The Plex output — the far end of the Phase 1 vertical slice — takes an optional free-text instance
setting, `library`:

- **Empty** → the server's music library, if there is exactly one.
- **Filled** → matched case-insensitively against music library titles, **or** as a bare section
  id, so the v1 importer ([013](013-v1-importer-shape.md)) can carry v1's `section_id` (stored as the
  option string `"Title [id]"`) across by extracting the id.
- **Unresolvable** (empty with several music libraries, no title match, library since deleted) →
  the run fails with a `misconfigured` error that **lists the server's music libraries by title**,
  so the error message does the picker's job. It never falls back to all libraries, as the beta did:
  a sync silently writing against libraries the user never chose is worse than a failed run.

### Handed forward

- **Map fog** — "Dynamic option lists (pickers)" in *Not yet specified*, carrying the four pieces
  above. Graduates into a ticket once parity is reached.
- **The Plex port** — implements `library` as above.
- **013** — the importer may map v1's `section_id` into `library` via its id.
