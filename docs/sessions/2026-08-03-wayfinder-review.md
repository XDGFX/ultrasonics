# Session — 2026-08-03 — Wayfinder review of the Phase 0 plan

Participants: Cal + Claude (Opus 5). Branch: `revival`.

## What happened

Cal asked for the revival plan to be validated with `/wayfinder` — is it complete, and should it
change? Read the whole plan set (roadmap, operating model, wave board, ADRs 0001–0006, `CONTEXT.md`,
`plugin-sdk-v2.md`, `legacy-architecture.md`, kickoff session) and assessed it against wayfinder's
lens: is the destination named, are the open decisions ticketed, and where is the fog nobody has
graduated.

**Verdict:** the plan is strong — the reference material especially — but it had a consistent gap:
**decisions noted in prose that no cell owned**. Twelve findings; Cal accepted all of them.

## Decisions taken

- **Everything lands on `revival` directly; PRs are not forced.** `revival` is a working branch,
  not production. PRs are kept only for genuinely parallel work (Phase 2's one-agent-per-plugin
  waves), where they isolate siblings and give CI a per-plugin verdict. → `operating-model.md` §2a,
  `AGENTS.md` "Branching". The `ops-model-doc` / `ops-model-review-fixes` branches are deleted.
- **`system-command` is dropped**, not ported. Arbitrary shell execution is incompatible with
  multi-tenancy (ADR-0002/0003); webhook + CLI runner serve the self-host case.
- **Subsonic moves to Phase 3** — it is net-new, so it cannot sit under a "parity with v1" gate.
- **The decision map is local markdown**, not GitHub issues: `XDGFX/ultrasonics` is public with
  275 stars and 40+ real user reports, and planning tickets would both leak and drown them. This is
  wayfinder's documented fallback when no tracker is configured.

## Artifacts produced

- **`docs/plans/map.md`** — the wayfinder map. Destination (Phase 0 contracts frozen), Notes,
  Decisions-so-far, **Not yet specified** (the fog), **Out of scope**.
- **`docs/plans/tickets/001–009`** — one decision each, with blocking edges. Frontier: 001, 003,
  004, 008, 009.
- **`docs/proposals/auth-provider-v2.md`** — new. The Phase 0 gate required freezing `AuthProvider`
  but there was nothing to freeze; ADR-0005 is a decision, not a surface.
- Rewrites: `roadmap.md` (Phases 0–3, 5), `operating-model.md` (§1 sizing, new §2a branching, §3
  board-vs-map, §6 waves), `wave-board.md` (decisions split into Wave 0.2, ports to 0.3),
  `CONTEXT.md` (user-auth glossary), `AGENTS.md`, `docs/README.md`, `proposals/README.md`,
  `legacy-architecture.md`, `plugin-sdk-v2.md`.

## The gaps that drove it

1. **No cell owned the tenant-scoped database schema** — despite ADR-0003 calling it the one
   unretrofittable thing. → ticket 002.
2. **`AuthProvider` had no draft surface** to freeze at the Phase 0 gate. → `auth-provider-v2.md`
   + ticket 006.
3. **Two things called "auth"** — service credentials vs user accounts/login — and the second had
   no home in the roadmap, the operating model, or the glossary. → ticket 001 + `CONTEXT.md`.
4. **Wave 0.2's SDK cell was oversized** — five open questions plus the auth freeze. Split into
   003, 004, 005, 007; isolation and the trigger model *constrain* the SDK surface, so they resolve
   first.
5. **Trigger AND→OR** was a known bug with no owner, drifting toward a Phase 2 plugin cell despite
   being runner semantics. → ticket 004, built in Phase 1.
6. **Backlog triage** first appeared in Phase 3's exit gate, so Phases 1–2 would have been built
   without the evidence. → ticket 009, on the frontier now.

## State

Still **documentation only** — no code. Phase 0 unchanged in intent; its shape is now decisions
(map) running alongside build (board).

## Next concrete steps

1. Open **Wave 0.0** — file the Spotify extended-quota and Apple Developer applications. Lead time
   is the one thing engineering speed can't compress; this has been "queued" since 2026-07-28.
2. Take map ticket **001 (account and tenant model)** — deepest dependency, unblocks 002 and 006.
3. Run **003 (plugin isolation)** and **009 (issue triage)** as AFK research/task cells in parallel.
4. Dispatch **Wave 0.1** (scaffold), taking its conventions brief from ticket 008.

## Open questions carried forward

All open decisions are now tickets on `map.md` — that is the point of the map. Fog that isn't yet
sharp enough to ticket lives in its **Not yet specified** section (importer shape, conformance-test
contents, self-host first-run UX, scheduler architecture, Zod→form generation).

## Note

`/verify` is referenced by `operating-model.md` §1 and §5 as a mandatory gate. It could not be
found in `~/.claude/skills`, `~/.claude/commands`, or the built-in skill list; Cal believes it is a
Claude built-in. Left as-is — if a cell ever reports "no such skill", that is the cause, and the
built-in `/run` skill is the nearest equivalent.
