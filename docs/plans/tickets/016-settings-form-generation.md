# 016 — Zod → settings-form generation

**Status:** resolved · **Type:** grilling · **Blocked by:** 005 ✅ · **Blocks:** — · **Claimed by:** Cal (agent session 2026-10-15)

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

## From 009

The issue triage found the **blank-number trap**. #47 crashed on `float('')`. The obvious fix,
`z.coerce.number()`, turns `''` into `0`, and a fuzzy ratio of 0 matches every song. So the renderer
must map an empty numeric input to `undefined`, so that `.default(90)` applies. This belongs in the
acceptance criteria. One renderer for persistent and instance settings also closes #5.

## Answer

Agreed with Cal on 2026-10-15, across three grilling rounds. The decision is
[ADR-0019](../../adr/0019-settings-forms-rendered-from-json-schema.md). In short:

1. **Transport:** Zod is pinned at v4. The server serves `z.toJSONSchema(…, { io: "input" })`, and
   `packages/web` renders JSON Schema without ever importing plugin code.
2. **Copy:** a typed SDK helper over `.meta()`, with `title`, `description`, `placeholder` and
   `warning` on a field, an object or a union variant. Plain text only. `secret` is legal in auth
   `fields` only.
3. **Subset:** string, number or int, boolean and enum leaves; optional, default and server-only
   refine wrappers; a flat object or a discriminated union of flat objects at the top. No nesting,
   arrays, transforms or `coerce`. `runConformance` enforces it.
4. **Discriminated union:** hidden branches are kept while the form is open; only the active branch
   is saved. **Radio versus select is not decided here.** It goes to the Phase 1 spec, to be judged
   by feel on a prototype of the Spotify input form.
5. **Validation:** the server is the only validator, and its issues map onto fields by `path`. HTML
   attributes give instant hints. **Empty means absent**, so `.default(90)` applies (the 009
   criterion).
6. **One renderer** for persistent settings, instance settings (per slot) and the auth wizard's
   `fields`, which closes #5. `persistentSettings` becomes optional.
7. **Invalid stored values** (after a plugin update or import) are loaded as far as they fit and
   shown with their issues. Saving is blocked, and a run fails before plugin code with the fields
   named. Automatic settings migration between plugin versions is left in the fog.
