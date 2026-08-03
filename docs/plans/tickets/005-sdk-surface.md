# 005 — Plugin SDK surface freeze ⛔

**Status:** Open · **Type:** grilling · **Blocked by:** ~~003 ✅~~, **004** · **Blocks:** 007 ·
**Claimed by:** —

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
