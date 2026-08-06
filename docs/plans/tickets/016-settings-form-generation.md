# 016 — Zod → settings-form generation

**Status:** Open · **Type:** grilling · **Blocked by:** 005 ✅ · **Blocks:** — · **Claimed by:** —

## Question

How does `packages/web` turn a frozen Zod settings schema into a rendered form?

Graduated from the map's **Not yet specified** on 2026-08-06, when 005 froze the settings shape.
It was fog until then because the schema it consumes did not exist; it is sharp now, and
[ADR-0012](../../adr/0012-plugin-sdk-surface-keyed-by-component.md) made it load-bearing rather than
merely convenient.

**This is the mechanism by which v1's hand-written `builder()` blocks actually disappear.**
ADR-0004 promised "one schema, three uses" and asserted the UI-description dicts "largely
disappear" — but nothing has yet had to render one. If this ticket cannot render what 005 froze, the
promise fails at the last step and plugins quietly grow bespoke UI again.

Decide:

1. **How a `z.discriminatedUnion` renders.** ADR-0012 pushed v1's conditional-field behaviour into
   the schema: Spotify's `playlists-only` / `saved-only` fields are a union discriminated on `mode`,
   where v1 hand-wrote client-side JavaScript toggling `shy` CSS classes. The form must show the
   discriminator, then swap the dependent fields when it changes. This is the single hardest case and
   the reason the ticket exists.
2. **The supported schema subset.** Zod can express far more than a form can render. Which types are
   legal in `persistentSettings` / `instanceSettings` — and is the subset *enforced*, or merely
   documented and discovered when something renders as a broken input? A machine-checked answer
   belongs in `runConformance`, alongside the checks ADR-0012 §8 added.
3. **Where labels and help text come from.** v1's builders carried prose — long explanatory
   paragraphs, emoji, warnings about destructive playlist updates (see `up_plex.py`). A bare Zod
   schema has no room for that. `.describe()`, a parallel metadata map, or is that copy simply lost?
   Losing it would be a real regression in a UI whose warnings prevent data loss.
4. **Which component's schema is shown, and when.** `instanceSettings` is keyed by component
   (ADR-0012 §1), so the form depends on the slot the user dropped the plugin into.
5. **Validation feedback.** The same schema validates server-side; how do Zod issues map onto
   per-field errors in the UI, and is client-side validation shared code or a re-implementation?

## Not this ticket

- **Dynamic option lists** — "pick from your playlists", needing credentials at build time. That is
  [007](007-dynamic-options.md), and ADR-0012 constrains its answer: it must not make
  `instanceSettings` a function again, because this ticket depends on that field being static.
- The `AuthSpec`'s own UI (the "Authorise Spotify" flow) — that is 006's surface, not a settings
  form.

## A good resolution

Enough for a Phase 1 build of the settings form without further decisions: the renderable schema
subset and whether it is enforced, how a discriminated union behaves, where prose lives, and how
validation errors surface. A rough prototype of the Spotify input form — the hardest real case —
would settle most of it faster than argument; `/prototype` is the right tool.
