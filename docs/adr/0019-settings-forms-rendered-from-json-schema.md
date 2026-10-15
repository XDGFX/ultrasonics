# ADR-0019 — Settings forms are rendered from JSON Schema

**Status:** Proposed
**Date:** 2026-10-15
**Builds on:** ADR-0004 (one schema, three uses), ADR-0012 (static `instanceSettings` keyed by
component, discriminated unions for conditional fields), ADR-0013 (auth `fields` are a Zod object)
**Amends:** `docs/proposals/plugin-sdk-v2.md`. `persistentSettings` becomes optional, and the
conformance suite gains the renderable-subset check.
**Ticket:** [`docs/plans/tickets/016-settings-form-generation.md`](../plans/tickets/016-settings-form-generation.md)

## Context

ADR-0004 promised that v1's hand-written `builder()` blocks would disappear and the settings schema
would drive the UI, but nothing had yet had to render one. In v1, a form was a list of prose lines,
`text` inputs, radios and selects. Spotify's input built its conditional fields as raw HTML, with
JavaScript toggling `shy` classes. v1's warnings that prevent data loss, such as Plex's "existing
tracks will be removed", were prose lines placed between the fields. A bare Zod schema has no room
for that copy.

## Decision

### 1. The server serves JSON Schema; the web package renders it

Zod is pinned at **v4**. The server converts each schema with `z.toJSONSchema(schema, { io: "input" })`
and serves the result from the API. `packages/web` never imports plugin code. With `io: "input"`, a
field that has a `.default()` arrives as optional, with its default prefilled.

### 2. Copy lives in the schema, through a typed metadata helper

The SDK exports a helper over Zod 4's `.meta()`, with a fixed vocabulary:

- `title`: the label;
- `description`: help text;
- `placeholder`;
- `warning`: rendered with emphasis, for copy that prevents data loss;
- `secret`: renders a password input that is never echoed back. It is legal in auth `fields` only,
  since a secret is auth by ADR-0012's boundary rule.

`title`, `description` and `warning` apply to a field, to an object (the form's introduction), or to
a union variant (its option label and explanation). All of it is plain text; emoji are fine. Raw
HTML is not supported, which closes v1's `| safe` injection route.

### 3. The renderable subset is enforced

Phase 1 allows the following:

- **Leaves:**
  - `z.string()`, with optional min/max length or regex;
  - `z.number()` and `.int()`, with min/max;
  - `z.boolean()`;
  - `z.enum()`.
- **Wrappers:** `.optional()`, `.default()`, and `.refine()`. A refinement runs only on the server
  and is invisible to JSON Schema, so its message shows at form level.
- **Top level:** one flat `z.object`, or a `z.discriminatedUnion` of flat objects.
- **Banned:** nested objects, arrays, records, tuples, plain unions, transforms, pipes and
  `z.coerce`. A form must save exactly what it shows, and `coerce` turns a blank number into `0`.

`runConformance` converts every settings and auth schema and walks the result. A node outside the
subset fails the suite, and the failure names its path. Widening the subset means extending the
checker and the renderer together. Adding a type is additive.

### 4. A discriminated union keeps hidden branches but saves one

The discriminator renders as a choice control. While the form is open, it keeps the values of
hidden branches, so switching back restores them. Only the active branch is submitted, so a stored
value always parses. The choice control (radios, a select, or both by option count) is decided
while prototyping Spotify's input form in the Phase 1 spec, not here.

### 5. The server is the only validator

On save, the server parses the value with the plugin's schema and returns its issues as
`{ path, message }[]`. The renderer attaches each issue to the field at that path. Issues at the
root, or with no matching field, show above the form. HTML attributes (`required`, `min`, `max`,
`pattern`) taken from the JSON Schema give instant hints. Phase 1 has no client-side validator.

**Empty means absent.** Before submitting, the renderer drops every key whose input is empty, so
`.default()` and `.optional()` apply, and a required field left blank comes back as an issue.

### 6. One renderer, three schemas

The same renderer draws:

- `persistentSettings`, on the plugin's account-wide settings page;
- `instanceSettings[component]`, in the applet builder, for the slot the plugin sits in;
- the auth wizard's `fields`.

An empty object renders no form. `persistentSettings` is **optional**: a plugin without it is not
listed on the settings page.

### 7. A stored value that no longer parses

After a plugin update or a v1 import, a stored value may fail its schema. The form then opens with
every value that still fits and shows the issues at once. It cannot be saved until they are fixed.
A run with invalid settings fails before any plugin code runs, and its error names the fields.
Migrating settings automatically between plugin versions is not decided here.

## Considered options

- **The web package imports plugin packages and renders Zod directly.** Rejected because it bundles
  service SDKs into the SPA and crosses ADR-0010's Worker-shaped boundary.
- **A bespoke form-descriptor format.** Rejected: the renderer would be simpler, but ultrasonics
  would then own a second schema language.
- **A parallel UI-metadata map beside the schema.** Rejected because the copy would drift away from
  the fields it describes, and conformance would need a second parity rule.
- **Shared client-side validation (ajv on the JSON Schema).** Deferred. It is a second validator
  that can disagree with Zod, and HTML attributes cover the instant cases.

## Consequences

- A plugin cannot ship bespoke UI. Anything the subset cannot express needs the subset widened,
  in the SDK, for every plugin.
- Plex's destructive-update warning and Spotify's saved-mode caveat survive, as `warning` metadata.
- `z.boolean()` replaces v1's Yes/No radios, which changes what the v1 importer maps (ADR-0017).
- Pickers (ticket 007's deferred hook) will need arrays or option sources, which widens §3.
