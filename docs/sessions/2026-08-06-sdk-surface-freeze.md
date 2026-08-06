# 2026-08-06 — Plugin SDK surface freeze (map ticket 005)

/ wayfinder, working the map. One ticket resolved.

## Housekeeping first

`revival` was **stale**. Ticket 004's resolution (ADR-0011, ticket 014 resolved, 015 graduated) had
been committed on `worktree-wayfinder-004-trigger-model` but never merged, so the map on trunk still
showed 004 as frontier and 005 as blocked. Fast-forwarded `revival` onto it before starting —
nothing else could be picked correctly until the map was current.

Worth noting as a recurring hazard: a wayfinder session that commits to its worktree and stops
leaves trunk lying to the next session about where the frontier is.

## Done

**Ticket 005 — Plugin SDK surface freeze ⛔ — resolved** → ADR-0012, accepted by Cal in-session.

The freeze answered all five of the ticket's open questions plus one it surfaced. The organising
idea: **`component` is the keying axis throughout the surface**, where v1 branched on it at runtime.

1. `instanceSettings` — a static record keyed by component, not `(ctx) => ZodObject`.
2. `run` — one handler per component, not one `run(ctx)` with a branch.
3. The `component` declaration — **removed**, derived from `Object.keys(run)`.
4. Registry — `name → { path, load() }`, satisfying ADR-0010's worker-path constraint without
   giving up ADR-0004's explicitness.
5. `test()` — optional, returning a plain-data `TestResult` rather than throwing.
6. Settings/auth boundary rule — *if you cannot open an authenticated connection without it, it is
   auth, not a setting.*

`RunContext` ratifies ADR-0010 unchanged.

### What decided it

A survey of all 16 v1 plugins, and it reframed the central question. "v1's builder is dynamic" —
the standing argument for the function form — turned out to be three separable behaviours:

- **11 of 16 branch on `component`**, and on *nothing else*. The same 11 branch on `component`
  inside `run()` too. Structural keying covers this exactly.
- **Conditional fields within one component** (Spotify's `shy` `playlists-only` / `saved-only`
  classes) is a dependent-field problem — hand-written client-side JavaScript in v1, a
  `z.discriminatedUnion` in v2.
- **Only `up_plex.py`** genuinely needs a function: it performs an HTTP request inside `builder()`
  to list library sections. That is ticket 007's, not the freeze's.

So the function form was buying flexibility for a need that does not exist in this ticket, at the
cost of making the schema opaque to form generation.

Second finding: only **5 of 16** plugins define `test()`, and those that do test more than
credentials (Plex tests reachability, `local music database` tests a DB). The proposal's "throw on
invalid credentials" was both too narrow and, under ADR-0010's constraint 4, unable to tell the UI
*which* failure occurred — structured clone erases the `Error` subclass.

### Also touched

- `plugin-sdk-v2.md` — moved off `Draft` to **Frozen**; surface rewritten; the open-questions
  section kept as a closed paper trail rather than deleted.
- `CONTEXT.md` — **Handshake** no longer declares component types; **Component** and **Plugin SDK**
  amended.
- Ticket **016 — Zod → settings-form generation** created, graduated from the map's fog.
- Map — 005 into Decisions-so-far, 016 into the table, the conformance-test fog entry narrowed to
  what actually remains unclear.

## Next

The frontier is now **006, 008, 009, 011, 012, 013, 015, 016**.

**006 (AuthProvider surface freeze ⛔) is the one to take next.** It is the last Phase 0 contract
still open, it is the only thing blocking 007, and this session handed it two things it did not have
before: the settings/auth boundary rule, and the fact that `ctx.auth` exists and is async with its
shape entirely 006's to fix.

**016 is worth a `/prototype` session rather than pure grilling** — rendering the Spotify input
form (the hardest real case, a discriminated union) would settle most of its questions faster than
argument. Flagged in the ticket.

## Watch out for

The freeze made **016 load-bearing**, which it was not before. ADR-0004 promised v1's hand-written
`builder()` blocks "largely disappear", and the discriminated union is now the mechanism that
delivers it. If 016 cannot render one cleanly, that promise fails at the last step and plugins
quietly regrow bespoke UI. It is no longer a nice-to-have in `packages/web`.

Also carried forward, per the map's standing caution: no paraphrase-hardened constraints were leaned
on this session. The "dynamic builder" framing came closest — it is repeated in ADR-0004 and the
proposal as if settled, and the plugin survey is what disconfirmed it. Checking the source was again
the thing that mattered.
