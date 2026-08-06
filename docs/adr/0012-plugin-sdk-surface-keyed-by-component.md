# ADR-0012 — The plugin SDK surface is keyed by component

**Status:** Proposed
**Date:** 2026-08-06
**Refines:** ADR-0004 (which committed to a typed SDK and named `plugin-sdk-v2.md` as the place the
exact surface would be specified — this is that specification, and it diverges from ADR-0004's
sketch in five places)
**Constrained by:** [ADR-0010](0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md)
(the nine boundary constraints and the `RunPayload`/`RunContext` split),
[ADR-0011](0011-triggers-are-server-capabilities-not-plugins.md) (three components, no trigger)
**Ticket:** [`docs/plans/tickets/005-sdk-surface.md`](../plans/tickets/005-sdk-surface.md)

## Context

ADR-0004 decided that plugins are typed modules registered explicitly, and deferred the exact
surface to `docs/proposals/plugin-sdk-v2.md`. Ticket 005 froze that surface. Under ADR-0004 it is a
checkpoint gate and changes only deliberately from here, so the freeze had to resolve every
remaining ambiguity rather than leave one for the first plugin port to settle by accident.

Three prior decisions narrowed the job before it started: ADR-0010 handed it nine constraints, a
`RunPayload`/`RunContext` split and a registry-shape requirement; ADR-0011 removed `Trigger` as a
component, leaving three; and third-party install was already out of scope.

**A survey of all 16 v1 plugins reframed the central question.** v1's `builder()` is usually
described as "dynamic", which is the argument for the proposal's
`instanceSettings: (ctx) => ZodObject`. But the survey found three separable behaviours wearing that
one word:

1. **Branching on `component`** — 11 of 16 builders, and they branch on *nothing else*. The same 11
   branch on `component` inside `run()` too.
2. **Conditional fields within a single component** — Spotify's `playlists-only` / `saved-only`
   fields, driven by a `mode` radio. In v1 this is hand-written client-side JavaScript toggling
   `shy` CSS classes. It is a dependent-field problem, and Zod expresses it natively as a
   discriminated union.
3. **Genuinely dynamic option lists** — `up_plex.py` performs an HTTP request inside `builder()` to
   list the server's library sections. This is the only behaviour that needs resolved credentials at
   *build* time, and it is already ticket 007's.

Only (3) requires a function, and (3) is out of this freeze. So the function form was buying
flexibility for a need that does not exist here, at the cost of making the settings schema opaque to
the form generator in `packages/web` — which would have to execute the function with a fabricated
context, per component, to learn what fields exist.

A second survey finding: only 5 of 16 v1 plugins define `test()`, and those that do test more than
credentials — Plex tests server reachability, `local music database` tests a local database. The
proposal's framing of `test()` as "throw on invalid credentials" was both too narrow and, under
ADR-0010's constraint 4, unable to tell the UI which failure occurred.

## Decision

**`component` is the keying axis throughout the surface.** Where v1 branched on it at runtime, v2
keys on it structurally.

### 1. `instanceSettings` is a static record keyed by component, not a function

```ts
instanceSettings: {
  inputs:  z.discriminatedUnion("mode", [ /* … */ ]),
  outputs: z.object({ existing: z.enum(["append", "update"]).default("append") }),
}
```

Plain data, so `packages/web` reads the schema for the component the user picked without executing
anything. Intra-component conditionality — behaviour (2) above — is expressed with
`z.discriminatedUnion`, which the form generator can render statically. Dynamic option lists remain
ticket 007's problem and are expected to arrive as a separate hook, not by making this field a
function again.

### 2. `run` is a record of per-component handlers, not one `run(ctx)`

```ts
run: {
  async inputs(ctx)    { /* … */ return songs },   // Promise<SongDict>
  async modifiers(ctx) { /* … */ return songs },   // Promise<SongDict>
  async outputs(ctx)   { /* … */ },                // Promise<void>
}
```

Each handler receives a precisely typed context: `ctx.instance` is the schema under the matching
`instanceSettings` key, and `ctx.songs` exists only on the modifier and output contexts. The
proposal had one flat context where `songs` was "present for modifiers/outputs; empty for inputs"
and the *runner* enforced the return type. Both were runtime conventions doing work the compiler can
do, and the empty-dict-for-inputs fiction is now gone.

The executor dispatches on `payload.component`, which costs it nothing — it already carries the
component.

### 3. The `component` declaration is removed and derived

With `run` and `instanceSettings` both keyed by component, a declared `component: [...]` array was a
third copy of the same list and a third chance to disagree. `plugin.components` is derived from
`Object.keys(run)`. `mode` stays declared — it is a genuinely separate axis.

### 4. The registry is a record of `name → { path, load() }`

```ts
export const officialPlugins = {
  spotify: { path: "@ultrasonics/plugins/spotify", load: () => import("./spotify") },
  plex:    { path: "@ultrasonics/plugins/plex",    load: () => import("./plex") },
} as const satisfies PluginRegistry;
```

This satisfies ADR-0010's registry constraint without giving up ADR-0004's explicitness.
`InProcessExecutor` calls `load()`; a Phase 2 `WorkerExecutor` hands `path` to the worker, which
cannot receive an imported module object across `postMessage`. Keying by name also serves the
runner's actual lookup — resolving a persisted applet's plugin — which ADR-0004's `as const` array
made a linear scan.

### 5. `test()` returns a plain-data result rather than throwing

```ts
test?: (ctx: TestContext) => Promise<TestResult>;

type TestResult =
  | { ok: true }
  | { ok: false; code: "invalid-credentials" | "unreachable" | "misconfigured"; message: string };
```

Optional, as the 5-of-16 evidence supports. It returns plain data, so it satisfies ADR-0010's
constraint 1 by construction and the UI can distinguish "your token expired" from "your Plex box is
off" from "this plugin is misconfigured" — three failures needing three different remedies. Under
constraint 4 a thrown `Error` cannot carry that distinction: structured clone flattens the subclass
name, so the UI would receive an indistinguishable blob.

An actual `throw` from `test()` now means something specific and useful: the plugin itself is broken.

`TestContext` carries `persistent` settings and auth but **no** `instance` settings — `test()` runs
before any applet exists.

### 6. The settings/auth boundary rule

**If you cannot open an authenticated connection to the service without it, it is auth — not a
setting.** Plex's `server_url` and TLS-verification toggle are therefore part of the `AuthSpec`
(ADR-0005's `serverUrl` flow), while its `plex_prepend` / `ultrasonics_prepend` path mapping is
`persistentSettings`. This exists because v1's `handshake.settings` conflated an auth button,
connection configuration and genuine preferences in one list, and ticket 006 needs a stated line
rather than an assumption about which of them it owns.

### 7. `RunContext` ratifies ADR-0010 unchanged

`credentials` is a plain-data token bag; behaviour (`refresh()`) lives on an async `ctx.auth` facade,
whose own shape is ticket 006's to fix — 005 fixes only that it exists and is `Promise`-returning.
`log` is a fire-and-forget facade reconstructed plugin-side, returning `void`. `runId` and
`deadlineMs` are present from day one. `configDir` stays a path string.

### 8. Three additions to `runConformance`

Per the repo's preference for machine-checked invariants over conventions:

- **Key parity** — `Object.keys(run)` must equal `Object.keys(instanceSettings)`. Catches a handler
  that would never be dispatched, and a settings schema for a component the plugin does not
  implement.
- **The `structuredClone` boundary check** and **the lost-methods prototype assertion**, both
  carried over from ADR-0010 §5.

## Consequences

- **The SDK surface is frozen.** `plugin-sdk-v2.md` moves off `Draft`; a Phase 2 plugin port needs
  no further SDK decisions. Changing any of the above is now an ADR-level act (ADR-0004).
- **Ticket 007 is unblocked from this side** and inherits a narrowed brief: it must add dynamic
  option fetching *without* making `instanceSettings` a function again, since the form generator now
  depends on that field being static.
- **`packages/web` must render a `z.discriminatedUnion`.** This is a real requirement the proposal
  did not have, and it is the mechanism by which v1's hand-written `shy`-class JavaScript
  disappears. Ticketed as [016](../plans/tickets/016-settings-form-generation.md), graduated from
  the map's fog by this decision.
- **Every plugin port writes one handler per component** rather than one `run()` with a branch. For
  the 11 of 16 that branched anyway this is a straight simplification; for the 5 that did not it is
  unchanged.
- **The `PluginExecutor` seam gains a dispatch step.** `InProcessExecutor` selects
  `plugin.run[payload.component]`; a `WorkerExecutor` does the same inside the worker after loading
  `path`. ADR-0010's claim that the swap is a pure runner change still holds.
- **Nothing here is implemented.** The surface is specified, not built; Phase 1 scaffolding is the
  first thing to consume it.

## Alternatives rejected

- **`instanceSettings: (ctx) => ZodObject`**, as sketched. Rejected because the only branch v1
  actually takes is on `component`, which the record form captures structurally, and because a
  function is opaque to form generation. Its remaining motivation — dynamic option lists — is ticket
  007's and does not require this field to be a function.
- **A single static schema for all components.** Rejected on the evidence: 11 of 16 plugins genuinely
  need different fields per component, and merging them yields one object of mutually irrelevant
  optional fields, with nothing preventing an applet from setting an output-only field on an input.
- **One `run(ctx)` with a discriminated-union context.** Sound, but every multi-component plugin
  opens with a narrowing block, and the return type stays a `SongDict | void` union the compiler can
  only loosely check — an input returning nothing would still compile.
- **Keeping `component` declared and authoritative**, with extra `run` keys ignored. Rejected: it
  silently tolerates dead handlers, which is the class of bug the typed SDK exists to remove.
- **Keeping the `as const` array registry** with a `modulePath` field on each plugin. Rejected: a
  plugin declaring its own module path is self-referential, nothing checks it after a file move, and
  name lookup stays a scan.
- **`test()` throwing a coded plain-data error.** Closer to the sketch's ergonomics, but it depends
  on every plugin throwing the right type, and one stray `throw new Error("nope")` degrades to the
  blob the return-shape exists to avoid.
