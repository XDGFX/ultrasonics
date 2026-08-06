# Proposal: Plugin SDK v2

**Status:** Frozen — ticket [005](../plans/tickets/005-sdk-surface.md) resolved 2026-08-06,
ratified by [ADR-0012](../adr/0012-plugin-sdk-surface-keyed-by-component.md).

Fleshes out ADR-0004 (typed plugin SDK, explicit registration) into a concrete surface. This is the
contract every plugin depends on, so it is a checkpoint gate (AGENTS.md). **It is now frozen:**
nothing here is implemented yet, but the shapes below are decided, and changing one is an ADR-level
act — not something a plugin port settles in passing.

Read [ADR-0012](../adr/0012-plugin-sdk-surface-keyed-by-component.md) for *why* each shape is what
it is, the alternatives rejected, and the v1 survey the decisions rest on. This document is the
contract; the ADR is the reasoning.

## Goals

1. A plugin is a typed module; malformed plugins fail at compile/registration, not mid-sync
   (v1 issue #59).
2. **One schema, three uses** — a plugin's settings are declared once (Zod) and drive runtime
   validation, the inferred TS type, and the auto-generated settings form. v1's hand-written
   `builder()` UI-description dicts largely disappear.
3. Auth is *declared, not implemented* by the plugin (ADR-0005): the plugin says "I need Spotify
   OAuth"; the `AuthProvider` decides how.
4. The song dict is the only interchange type, imported from `packages/core` (ADR-0006).

## The frozen surface

**`component` is the keying axis.** Where v1 branched on it at runtime, v2 keys on it structurally —
in `instanceSettings`, in `run`, and therefore in the context each handler receives.

### `definePlugin`

```ts
export default definePlugin({
  name: "spotify",
  description: "Sync playlists with Spotify",
  mode: ["playlists"],
  version: "2.0.0",
  auth: spotifyOAuth,                        // an AuthSpec, see below

  // Per-account, per-plugin (v1 `handshake.settings`, minus what auth now owns).
  persistentSettings: z.object({
    fuzzyRatio: z.number().min(0).max(100).default(90),
    createdPlaylists: z.enum(["public", "private"]).default("private"),
  }),

  // Per-applet (v1 `builder()`). A static record keyed by component — never a function.
  instanceSettings: {
    inputs: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("playlists"), filter: z.string().optional() }),
      z.object({ mode: z.literal("saved"), playlistTitle: z.string() }),
    ]),
    outputs: z.object({ existing: z.enum(["append", "update"]).default("append") }),
  },

  // One handler per component. Keys must match `instanceSettings` exactly.
  run: {
    async inputs(ctx) { /* … */ return songs },   // Promise<SongDict>
    async outputs(ctx) { /* … */ },               // Promise<void>
  },

  async test(ctx) { return { ok: true } },        // optional; see below
});
```

There is **no `component` field**. `plugin.components` is derived from `Object.keys(run)`, so the
list exists once rather than in three places that can disagree. `mode` is a genuinely separate axis
and stays declared.

**Intra-component conditionality is a `z.discriminatedUnion`**, as `inputs` shows above. v1 did this
with hand-written client-side JavaScript toggling `shy` CSS classes; it is now in the schema, which
is what makes it renderable and validatable rather than decorative.

### The run context (typed; replaces v1's `**kwargs`)

Shaped by [ADR-0010](../adr/0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md):
only a plain-data `RunPayload` crosses the boundary, and the SDK harness rebuilds a live context
around it plugin-side. Every data field is clone-safe; anything that reaches the host for an answer
is `Promise`-returning from day one, even though Phase 1 answers synchronously.

```ts
interface BaseRunContext<P, I> {
  appletId: string;
  runId: string;                      // attributes fire-and-forget log lines to a run
  deadlineMs: number;                 // wall-clock budget; reported in Phase 1, enforced in Phase 2
  // No account id: ADR-0007 keeps identity at the server layer and hands core pre-scoped
  // capabilities. `credentials` below is already resolved for the owning account.
  persistent: P;                      // validated persistentSettings
  instance: I;                        // validated instanceSettings for THIS component
  credentials: CredentialBag;         // plain data — no class instance, no methods
  auth: AuthFacade;                   // async; behaviour (refresh) lives here. Shape: ticket 006
  configDir: string;                  // a path string, never a handle
  log: Logger;                        // facade; fire-and-forget; every method returns void
}

type InputRunContext<P, I>    = BaseRunContext<P, I>;
type ModifierRunContext<P, I> = BaseRunContext<P, I> & { songs: SongDict };
type OutputRunContext<P, I>   = BaseRunContext<P, I> & { songs: SongDict };
```

`songs` exists **only** where it is meaningful. Inputs return a `SongDict`, modifiers return a
`SongDict`, outputs return `void` — enforced by the handler's type, not by a runtime check in the
runner.

### `test()`

Optional. Verifies that the plugin can actually reach and authenticate against its service — which
is broader than credentials: v1's Plex `test()` checks server reachability, and `local music
database` checks a local database.

```ts
test?: (ctx: TestContext) => Promise<TestResult>;

type TestResult =
  | { ok: true }
  | { ok: false; code: "invalid-credentials" | "unreachable" | "misconfigured"; message: string };
```

It **returns** a result rather than throwing. Under ADR-0010's constraint 4 a thrown `Error` crosses
the boundary with its subclass name flattened to `"Error"`, so the UI could not tell an expired
token from an unreachable server — three failures needing three different remedies. A `throw` from
`test()` therefore now means something specific: the plugin itself is broken.

`TestContext` carries `persistent` settings and auth but **no** `instance` settings; `test()` runs
before any applet exists.

### Auth declaration

```ts
const spotifyOAuth = defineAuth({
  service: "spotify",
  flow: "oauth2-pkce",                // pkce | oauth2 | apiKey | serverUrl | none
  scopes: ["playlist-read-private", "playlist-modify-private"],
});
```

The plugin references an `AuthSpec`; the active `AuthProvider` (BYO / PKCE / Proxy) turns it into
`Credentials` at run time. Self-host BYO and hosted Proxy differ only in which provider is wired
(ADR-0005) — the plugin is identical.

**The boundary against `persistentSettings`:** *if you cannot open an authenticated connection to
the service without it, it is auth — not a setting.* So Plex's `server_url` and its TLS-verification
toggle belong to the `AuthSpec` (the `serverUrl` flow), while its `plex_prepend` /
`ultrasonics_prepend` path mapping is `persistentSettings`. v1's `handshake.settings` conflated an
auth button, connection configuration and genuine preferences in one list; this rule separates them.
The `AuthSpec`'s own surface is ticket [006](../plans/tickets/006-authprovider-surface.md).

### Registration (explicit, not scanned)

```ts
// packages/plugins/registry.ts
export const officialPlugins = {
  spotify: { path: "@ultrasonics/plugins/spotify", load: () => import("./spotify") },
  plex:    { path: "@ultrasonics/plugins/plex",    load: () => import("./plex") },
  // …
} as const satisfies PluginRegistry;
```

A record keyed by plugin name, each entry pairing a **resolvable module specifier** with a **lazy
loader**. All three consumers are served by exactly one of those parts:

- `InProcessExecutor` calls `load()`.
- A Phase 2 `WorkerExecutor` hands `path` to the worker — an imported module object cannot cross
  `postMessage`, which is why ADR-0010 requires the path to exist from day one.
- The runner resolves a persisted applet's plugin by `officialPlugins[applet.plugin]`.

Third-party plugins would be added to this registry rather than dropped into a scanned folder; that
install story is out of scope until a third-party plugin exists (`map.md`).

## Conformance test

`packages/plugin-sdk` exports a `runConformance(plugin)` suite every plugin must pass to count as
ported (Phase 2 gate): valid handshake shape; `persistentSettings`/`instanceSettings` parse and
reject known-bad input; inputs return a schema-valid song dict; outputs accept one without mutating
it; declared `auth` resolves against a stub provider. This is the objective "is it done" bar.

Three checks are **machine-checked invariants**, not conventions — the first from this freeze, the
other two from ADR-0010 §5:

- **Key parity** — `Object.keys(run)` must equal `Object.keys(instanceSettings)`. Catches a handler
  that would never be dispatched, and a settings schema for a component the plugin does not
  implement.
- **The `structuredClone` boundary check** — push the payload and return value through
  `structuredClone()` and fail on `DataCloneError`.
- **The lost-methods assertion** — reject any field whose prototype is not `Object.prototype`,
  `Array.prototype`, or a known cloneable builtin. Structured clone *silently accepts* a class
  instance and strips its methods, so this is the half that actually catches the hazard.

What the suite asserts beyond this is still partly open — see `map.md`, **Not yet specified**.

## How this surface was settled

Every question this document once left open is now closed. Kept as the paper trail — a plugin port
should not have to rediscover why a shape is what it is.

**Closed by the freeze, ticket [005](../plans/tickets/005-sdk-surface.md) →
[ADR-0012](../adr/0012-plugin-sdk-surface-keyed-by-component.md):**

- ~~**Instance settings as a function of context** vs a static schema~~ — **static record keyed by
  component.** A survey of all 16 v1 plugins found "dynamic builder" covers three separable
  behaviours: 11 of 16 branch on `component` and on nothing else; conditional fields within one
  component are a `z.discriminatedUnion`; and only `up_plex.py`'s build-time HTTP fetch genuinely
  needs a function — which is ticket 007's, not this freeze's. A function would have made the schema
  opaque to form generation for a need that does not exist here.
- ~~**The `RunContext` shape**~~ — ratifies ADR-0010 unchanged.
- ~~**The `persistentSettings` / `instanceSettings` split**~~ — kept, with the auth boundary rule
  stated above.
- ~~**The registry shape**~~ — a record of `name → { path, load() }`.
- ~~**What `test()` means for the UI**~~ — a returned plain-data `TestResult`, not a throw.

The freeze also **removed the `component` declaration**, deriving it from `Object.keys(run)`.

**Resolved first, because they constrained this surface:**

- ~~**Plugin isolation**~~ — **resolved**, ticket [003](../plans/tickets/003-plugin-isolation.md) →
  [ADR-0010](../adr/0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md). The boundary
  is designed Worker-shaped now and executed in-process in Phase 1. **This amends the `RunContext`
  above** — `credentials` becomes plain data with behaviour moving to an async `ctx.auth` facade,
  `log` is specified as a reconstructed fire-and-forget facade, and `runId` / `deadlineMs` are added.
  The amended sketch and the nine constraints behind it are in ADR-0010 and
  [`../reference/plugin-isolation-research.md`](../reference/plugin-isolation-research.md); ticket 005
  ratifies them into this document at the freeze.
- ~~**Long-running triggers**~~ — **resolved**, ticket
  [004](../plans/tickets/004-trigger-model.md) →
  [ADR-0011](../adr/0011-triggers-are-server-capabilities-not-plugins.md). The answer is *neither*
  `run()` nor a `schedule()`/`subscribe()` shape: **the SDK does not model triggers at all.**
  `Trigger` is removed as a Component and the surface freezes at three — `inputs`, `modifiers`,
  `outputs`. Triggers become server-owned applet configuration (a schedule and/or an authenticated
  inbound webhook), so no trigger shape needs to satisfy ADR-0010's nine boundary constraints. The
  `component` union already sketched above is therefore correct as written, not an omission.

**Deferred past the freeze:**

- **Dynamic option fetching** (v1 builders that query the service for playlist names): needs
  resolved credentials at *build* time, before an applet is saved. How does the AuthProvider serve
  a builder, not just a run? → ticket [007](../plans/tickets/007-dynamic-options.md), which waits on
  `auth-provider-v2.md`. **Constrained by the freeze:** it must not return `instanceSettings` to a
  function, because form generation now depends on that field being static.
- **Third-party install** under explicit registration — **out of scope** for now (`map.md`): no
  third-party plugins exist, so the manifest-vs-build-step trade is unforced. Decide when one does.

## Out of scope

- The `AuthProvider` implementations themselves (own work, ADR-0005) and the `AuthSpec` surface
  (ticket [006](../plans/tickets/006-authprovider-surface.md)). This document fixes only that
  `ctx.auth` exists and is async.
- Any specific plugin's logic — see `docs/reference/legacy-architecture.md` per plugin.
- The frontend form-rendering engine that consumes the Zod schema (a `packages/web` concern) —
  ticket [016](../plans/tickets/016-settings-form-generation.md). Note that the freeze made this
  **load-bearing**: rendering a `z.discriminatedUnion` is now the mechanism by which v1's
  hand-written `builder()` blocks actually disappear.
- Plugin settings migration across a version bump — `legacy-architecture.md` assigns v1's
  `version_check` to the core settings/migration layer, not the SDK.
