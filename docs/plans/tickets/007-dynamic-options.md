# 007 — Builder-time credentials for dynamic options

**Status:** Open · **Type:** grilling · **Blocked by:** ~~005 ✅~~, ~~006 ✅~~ · **Blocks:** — ·
**Claimed by:** —

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
