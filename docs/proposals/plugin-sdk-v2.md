# Proposal: Plugin SDK v2

**Status:** Draft — captured for the Phase 0 SDK design pass.

Fleshes out ADR-0004 (typed plugin SDK, explicit registration) into a concrete surface. This is the
contract every plugin depends on, so it is a checkpoint gate (AGENTS.md) and must be agreed before
any plugin is written. Nothing here is implemented yet; the shapes below are a starting point to
grill and refine, not a decided API.

## Goals

1. A plugin is a typed module; malformed plugins fail at compile/registration, not mid-sync
   (v1 issue #59).
2. **One schema, three uses** — a plugin's settings are declared once (Zod) and drive runtime
   validation, the inferred TS type, and the auto-generated settings form. v1's hand-written
   `builder()` UI-description dicts largely disappear.
3. Auth is *declared, not implemented* by the plugin (ADR-0005): the plugin says "I need Spotify
   OAuth"; the `AuthProvider` decides how.
4. The song dict is the only interchange type, imported from `packages/core` (ADR-0006).

## Proposed surface

### `definePlugin`

```ts
export default definePlugin({
  name: "spotify",
  description: "Sync playlists with Spotify",
  component: ["inputs", "outputs"],        // was `type` in v1
  mode: ["playlists"],
  version: "2.0.0",
  auth: spotifyOAuth,                        // an AuthSpec, see below
  persistentSettings: z.object({             // global, per-plugin (v1 `handshake.settings`)
    fuzzyRatio: z.number().min(0).max(100).default(90),
    createdPlaylists: z.enum(["public", "private"]).default("private"),
  }),
  instanceSettings: (ctx) => z.object({      // per-applet (v1 `builder()`); may branch on component
    ...(ctx.component === "inputs"
      ? { mode: z.enum(["playlists", "saved"]), filter: z.string().optional() }
      : { existing: z.enum(["append", "update"]).default("append") }),
  }),
  async run(ctx): Promise<SongDict | void> { /* … */ },
  async test(ctx): Promise<void> { /* throw on invalid credentials */ },
});
```

### The run context (typed; replaces v1's `**kwargs`)

```ts
interface RunContext<P, I> {
  component: "inputs" | "modifiers" | "outputs";
  appletId: string;
  // No account id: ADR-0007 keeps identity at the server layer and hands core pre-scoped
  // capabilities. `credentials` below is already resolved for the owning account.
  persistent: P;                      // validated persistentSettings
  instance: I;                        // validated instanceSettings
  credentials: Credentials;           // resolved by the AuthProvider (ADR-0005)
  songs: SongDict;                    // present for modifiers/outputs; empty for inputs
  configDir: string;                  // was app._ultrasonics["config_dir"]
  log: Logger;
}
```

Inputs and modifiers return a `SongDict`; outputs return `void`. The runner enforces this by the
`component` type.

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

### Registration (explicit, not scanned)

```ts
// packages/plugins/registry.ts
export const officialPlugins = [spotify, plex, deezer, lastfm, /* … */] as const;
```

Third-party plugins are added to a registry rather than dropped into a scanned folder; the install
story for those is an open question (see below).

## Conformance test

`packages/plugin-sdk` exports a `runConformance(plugin)` suite every plugin must pass to count as
ported (Phase 2 gate): valid handshake shape; `persistentSettings`/`instanceSettings` parse and
reject known-bad input; inputs return a schema-valid song dict; outputs accept one without mutating
it; declared `auth` resolves against a stub provider. This is the objective "is it done" bar.

## Open questions

Split across tickets on `../plans/map.md` — these were originally one list, but three of them are
separate decisions with their own dependencies and two must be answered *before* this surface can
freeze.

**Owned by ticket [005](../plans/tickets/005-sdk-surface.md) — the freeze itself:**

- **Instance settings as a function of context** vs a static schema — the function form supports
  v1's component-branching builders and dynamic option lists (e.g. "pick from your playlists"), but
  complicates form generation. Is a static schema + a separate `dynamicOptions()` hook cleaner?
- The `RunContext` shape, the `persistentSettings`/`instanceSettings` split, the registry shape,
  and what `test()` means for the UI.

**Resolved first, because they constrain this surface:**

- ~~**Plugin isolation**~~ — **resolved**, ticket [003](../plans/tickets/003-plugin-isolation.md) →
  [ADR-0010](../adr/0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md). The boundary
  is designed Worker-shaped now and executed in-process in Phase 1. **This amends the `RunContext`
  above** — `credentials` becomes plain data with behaviour moving to an async `ctx.auth` facade,
  `log` is specified as a reconstructed fire-and-forget facade, and `runId` / `deadlineMs` are added.
  The amended sketch and the nine constraints behind it are in ADR-0010 and
  [`../reference/plugin-isolation-research.md`](../reference/plugin-isolation-research.md); ticket 005
  ratifies them into this document at the freeze.
- **Long-running triggers** (v1 webhook/time-trigger blocked). In v2 triggers should register
  intent with the scheduler/server, not block. Does the SDK model triggers as `run()` at all, or a
  distinct `schedule()` / `subscribe()` shape?
  → ticket [004](../plans/tickets/004-trigger-model.md).

**Deferred past the freeze:**

- **Dynamic option fetching** (v1 builders that query the service for playlist names): needs
  resolved credentials at *build* time, before an applet is saved. How does the AuthProvider serve
  a builder, not just a run? → ticket [007](../plans/tickets/007-dynamic-options.md), which waits on
  both this proposal and `auth-provider-v2.md`.
- **Third-party install** under explicit registration — **out of scope** for now (`map.md`): no
  third-party plugins exist, so the manifest-vs-build-step trade is unforced. Decide when one does.

## Out of scope

- The `AuthProvider` implementations themselves (own work, ADR-0005).
- Any specific plugin's logic — see `docs/reference/legacy-architecture.md` per plugin.
- The frontend form-rendering engine that consumes the Zod schema (a `packages/web` concern).
