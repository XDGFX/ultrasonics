# 005 — Plugin SDK surface freeze ⛔

**Status:** resolved · **Type:** grilling · **Blocked by:** ~~003 ✅~~, ~~004 ✅~~ · **Blocks:** 007 ·
**Claimed by:** Cal (wayfinder session, 2026-08-06)

## Question

Freeze the public surface of `packages/plugin-sdk`: `definePlugin()`, the handshake types, and
`RunContext`. This is the contract every plugin depends on, so it changes only deliberately after
this point (ADR-0004).

Grill `../../proposals/plugin-sdk-v2.md` — but note it arrives **narrower than it was written**,
because the review split three of its five open questions out:

- **Plugin isolation** → ticket 003, **now resolved** ([ADR-0010](../../adr/0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md)).
  It does not merely constrain this surface, it hands it a concrete brief: nine day-one constraints, a
  `RunPayload` / `RunContext` split, four amendments to the sketch, and a **registry-shape constraint**
  (keep a resolvable module path per entry, or the Phase 2 executor swap breaks the registry this
  ticket freezes). Read [003's resolution](003-plugin-isolation.md#resolution--2026-08-03) before
  opening this one — it is the input, not background.
- **Long-running triggers** → ticket 004, resolved first (it decides whether `run()` is even the
  shape for a trigger).
- **Third-party install** → ruled out of scope; no third-party plugins exist yet.

What remains for this ticket:

- **Instance settings as a function of context** (`instanceSettings: (ctx) => ZodObject`) vs a
  static schema. The function form supports v1's component-branching builders, but complicates
  form generation in `packages/web`. Is static schema + a separate `dynamicOptions()` hook cleaner?
- The **`RunContext` shape** — now constrained by 003's answer.
- Whether `persistentSettings` / `instanceSettings` is the right split of v1's
  `handshake.settings` vs `builder()`.
- The **registry** shape (`officialPlugins` as a const array) and how the runner resolves a plugin
  by name from a persisted applet.
- `test()` — optional, and what "throw on invalid credentials" means for the UI.

## Note on sizing

The review flagged the original Wave 0.2 cell as oversized: five open questions plus the
`AuthProvider` freeze in one session. Sessions are now 1M tokens, which helps — but 003, 004 and
006 are split out because they are **genuinely separate decisions with their own dependencies**,
not because of context limits. Do not re-merge them.

## A good resolution

- The frozen surface written into `plugin-sdk-v2.md`, status moved off `Draft`.
- An ADR if the shape diverges from what ADR-0004 implied.
- Enough certainty that a Phase 2 plugin port needs no further SDK decisions.

## Resolution — 2026-08-06

**The surface is frozen, and `component` is the keying axis throughout it.**
→ [ADR-0012](../../adr/0012-plugin-sdk-surface-keyed-by-component.md), which carries the full
reasoning, the rejected alternatives and the consequences. Accepted by Cal in the grilling session.

```ts
export default definePlugin({
  name: "spotify",
  description: "Sync playlists with Spotify",
  mode: ["playlists"],                   // separate axis; stays declared
  version: "2.0.0",
  auth: spotifyOAuth,                    // reachability + secrets

  persistentSettings: z.object({         // per-account, per-plugin
    fuzzyRatio: z.number().min(0).max(100).default(90),
  }),

  instanceSettings: {                    // static record, keyed by component
    inputs:  z.discriminatedUnion("mode", [ /* … */ ]),
    outputs: z.object({ existing: z.enum(["append", "update"]).default("append") }),
  },

  run: {                                 // one handler per component
    async inputs(ctx)  { return songs },      // Promise<SongDict>
    async outputs(ctx) { ctx.songs },         // Promise<void>
  },

  async test(ctx) { return { ok: true } },    // optional; plain-data result
});
```

### The five open questions, answered

1. **`instanceSettings`: static record keyed by component**, not `(ctx) => ZodObject`. A survey of
   all 16 v1 plugins found the "dynamic builder" story is three separable things: 11 of 16 branch on
   `component` and on *nothing else*; conditional fields within one component (Spotify's `shy`
   classes) are a `z.discriminatedUnion`; and only `up_plex.py`'s build-time HTTP fetch needs a
   function — which is ticket 007's, not this freeze's.
2. **`RunContext`**: ratifies ADR-0010 unchanged — plain-data `credentials`, async `ctx.auth` facade,
   fire-and-forget `log`, `runId`, `deadlineMs`, `configDir` as a string. `songs` exists **only** on
   the modifier and output contexts; the "empty dict for inputs" fiction is gone.
3. **`persistentSettings` / `instanceSettings` split**: kept, with a stated boundary against auth —
   *if you cannot open an authenticated connection without it, it is auth, not a setting*. Plex's
   `server_url` and TLS toggle are therefore ticket 006's; its path mapping is `persistentSettings`.
4. **Registry**: a record of `name → { path, load() }`. `load()` for in-process, `path` for the
   Phase 2 worker (ADR-0010's constraint), and the name key is the applet's plugin lookup.
5. **`test()`**: optional (only 5 of 16 v1 plugins define one), and returns a plain-data
   `TestResult` rather than throwing — under ADR-0010's constraint 4 a thrown `Error` reaches the UI
   with its subclass erased, so it cannot distinguish an expired token from an unreachable server.
   `TestContext` has no `instance` settings; `test()` runs before any applet exists.

Plus one the freeze surfaced: the **`component` declaration is removed** and derived from
`Object.keys(run)`, rather than being a third copy of the same list that can disagree with the other
two.

### What this hands forward

- **Ticket 007** — narrowed: it must add dynamic option fetching *without* returning
  `instanceSettings` to a function, since form generation now depends on it being static.
- **Ticket 006** — given a boundary rule rather than an assumption about what the `AuthSpec` owns,
  and told that `ctx.auth` exists and is async, with its shape left entirely to 006.
- **Ticket [016](016-settings-form-generation.md)** — new, graduated from the map's fog. Rendering a
  `z.discriminatedUnion` is now the mechanism by which v1's hand-written `builder()` blocks
  disappear, so it is load-bearing rather than merely convenient.
- **`runConformance`** gains key parity (`keys(run) === keys(instanceSettings)`) alongside
  ADR-0010's two boundary checks — clearing part of the map's "what the conformance test asserts"
  fog, though not all of it.
- **`plugin-sdk-v2.md`** moves off `Draft` and now describes the frozen surface.

### Deliberately not decided here

- `ctx.auth`'s own shape — 006.
- `persistentSettings` being account-scoped was treated as **settled by ADR-0009**, not reopened.
- Plugin settings migration across a version bump — `legacy-architecture.md` assigns v1's
  `version_check` to the core settings/migration layer, not the SDK.
