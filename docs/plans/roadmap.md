# Roadmap

Living plan. Five phases, each with a hard **exit gate**; a phase isn't done until its gate is
green. Sequential where correctness demands it, parallel where work is independent. Every phase
boundary is a checkpoint for Cal (AGENTS.md). Update the **Status** lines as work lands.

Decisions this plan rests on: ADR-0001 (stack), 0002 (revenue), 0003 (multi-tenancy), 0004 (plugin
SDK), 0005 (auth), 0006 (preserve song dict + fuzzymatch).

Decisions **not yet made** live on `map.md` — the wayfinder decision map. This roadmap assumes they
land; it does not make them.

---

## Phase 0 — Foundations
**Status:** in progress (docs) · **Owner mix:** mostly agents; Cal approves ADRs + SDK/auth contracts

Build the factory, not the product. Scaffold the Bun monorepo and CI. Freeze the plugin SDK
(ADR-0004) and `AuthProvider` (ADR-0005) as typed contracts *before* any plugin. Settle the
**account model** (ADR-0007) and the **account-scoped database schema** (ADR-0003, ADR-0009) — the
schema is the one thing that cannot be retrofitted later, so it is decided here, not in Phase 1.
Port the song dict to Zod. Establish the docs system (this repo, done) and `AGENTS.md`.

The contract decisions are tracked as tickets on `map.md`; the phase is not done until that map is
empty. How cells and waves are dispatched is in `AGENTS.md`.

**Start immediately, in parallel with everything (Cal, not agents):** file the **Spotify
extended-quota** and **Apple Developer** applications (ADR-0002's early track). Approval lead time is
the one dependency engineering speed cannot compress, so it must be ticking in the background from
the outset.

**The scaffold cell must deliver:**
- **Read-only CI with `:check` variants** — `lint:check` / `format:check` / `type-check` run
  read-only so CI *fails* rather than silently repairing (the mutating `bun run check` stays local).
  Trigger on both PRs and direct pushes to `revival`.
- **Import-cycle gate** — a `cycle-check` CI step with a `cycle-check:update` rebaseline escape hatch
  that must be justified in the commit message. A mechanical anti-slop guard on the dep graph.
- **`.claude/settings.json`** — a scoped permission allowlist (`bun test`/`build`/`check`, `git`,
  `gh`) to cut permission prompts during agent waves.
- **Conventions** — the file-suffix taxonomy, linter and test-layout calls come from map ticket
  [008](tickets/008-monorepo-conventions.md), not from the scaffold cell improvising.

**The core ports** — song dict → Zod with tests, and the fuzzymatch **golden corpus generated from a
runnable v1 checkout** (ADR-0006) so the port is pinned to v1's output before a line of it is
written. Keep a v1 checkout around long enough to produce it.

**Exit gate:** CI green on an empty pipeline · SDK + `AuthProvider` interfaces frozen · account
model + initial account-scoped schema decided (ADR'd) · trigger model settled · song-dict Zod schema
+ its tests merged · docs skeleton and ADRs in place · **`map.md` has no open tickets**.

## Phase 1 — Vertical slice (prove the whole pipe)
**Status:** not started · **Owner mix:** agents build; Cal reviews the slice end-to-end

The make-or-break phase. Port **fuzzymatch** with **golden tests generated from v1** (ADR-0006),
the applet runner, one input (**Spotify**, BYO + PKCE), one output (**Plex**, via the PlexAPI-style
approach — the most-requested pairing in the issues), and a minimal Vue UI to build and run *one*
applet. Implement the schema and account model decided in Phase 0 — account-isolation seams from day one
(ADR-0003), self-host still login-free. Build the **runner's trigger semantics** here (OR, not v1's
accidental AND) even though the trigger *plugins* land in Phase 2: it is core behaviour, not plugin
behaviour. Write the v1 SQLite **importer**.

**Exit gate:** a real Spotify playlist syncs to Plex through the UI (`/verify`) · fuzzymatch golden
tests reproduce v1 output · importer reads a v1 `ultrasonics.db` · self-host first run reaches a
working applet without a login prompt.

## Phase 2 — Plugin parity (fan out)
**Status:** not started · **Owner mix:** heavily parallel — one worktree + agent per plugin

Port the rest against the proven SDK: deezer, lastfm, local-music-database, local-playlists,
playlist-merger, spotify-mixer, custom-file, log-tracks, webhook, time-trigger. Each plugin is an
independent unit gated by the SDK **conformance test**. See `docs/reference/legacy-architecture.md`
for per-plugin behaviour and the parity matrix.

**Not ported:** `system-command` is **dropped** — arbitrary shell execution has no place in a
hosted product many accounts share (ADR-0002/0003), and the self-host case is served by the webhook trigger and
the CLI runner. `rickroll` and `skeleton` are v1 samples, not features. Subsonic is net-new, so it
sits in Phase 3 with the other new services rather than under a parity gate.

**Exit gate:** feature parity with v1 *minus the dropped plugins above* · every plugin passes
conformance + a smoke test · parity matrix in docs marked complete.

## Phase 3 — Beyond v1 (requested services + AI seams)
**Status:** not started · **Owner mix:** agents build; Cal prioritises from the issue backlog

Ship what people keep asking for and v1 never delivered: **YouTube Music** (#43), **Tidal** (#44),
**Apple Music** (#55), **Subsonic**. Reserve — don't fill — the AI seams:
`matcher.strategy = "fuzzy" | "llm"` and a natural-language playlist plugin. Opt-in only (ADR-0002).

Backlog triage happens *before* this phase, not in it (`map.md` ticket 009) — the point of triaging
early is that Phases 1–2 get the evidence of what users actually hit.

**Exit gate:** ≥1 net-new service shipped · AI-seam interface merged (implementation deferred) ·
Phase 3 backlog issues linked to the work that closes them.

## Phase 4 — Release & announce
**Status:** not started · **Owner mix:** agents draft; Cal presses publish

Multi-arch Docker image, a real docs site (v1's README admits documentation was "incomplete"), a
v1→v2 migration guide, and a 2.0 announcement to re-engage the 275 stargazers and open issues.

**Exit gate:** Docker image published · docs site live · migration guide tested against a real v1
install · release notes out.

## Phase 5 — Hosted tier (revenue)
**Status:** not started · **Owner mix:** agents build; Cal owns the business surface
**Early parallel track — start immediately, not when this phase opens:** file the Spotify
extended-quota and Apple Developer applications (ADR-0002). Approval lead time is measured in weeks
to months and is the one dependency no amount of engineering speed can compress, so it runs from
day one, in parallel with Phase 0. Tracked as Wave 0.0 on the board.

Turn the account-isolation foundation into the hosted SaaS (ADR-0002): the `Proxy` `AuthProvider` with
ultrasonics-owned app credentials, accounts/billing (Stripe, subscription + freemium), deploy
infra, per-service **kill-switch** flags, and the marketing site. Launches **cloud-services-only**;
the **home agent** (A2 — CLI runner with remote dispatch) is a later addon.

**Exit gate:** hosted signup → connect Spotify → sync works end-to-end · Stripe subscription +
freemium gate live · kill-switch verified · commercial-API approvals in hand for launch services.

---

## Deferred / not yet decided

Open decisions **for Phase 0** are tickets on `map.md`, not entries here. This list is what sits
*beyond* that map's destination — deliberately out of scope until a later phase makes it live.

- Exact freemium tier limits (Phase 5 launch detail).
- Hosting/infra choice for the hosted tier.
- A2 home-agent dispatch protocol (NAT traversal, auth).
- Third-party plugin distribution/install story under explicit registration (ADR-0004) — revisit
  when a third-party plugin actually exists.
- Product AI implementation (matcher `"llm"`, NL playlists) — seams only for now.
- Public-facing `README.md` rewrite — kept as-is until v2 is real to avoid misleading users.

## Dropped

- **`system-command` plugin** — not ported. Arbitrary shell execution is incompatible with a
  hosted product many accounts share (ADR-0002/0003); the self-host use case is served by the webhook trigger and
  the CLI runner. Reversing this is a fresh decision with its own ADR, not an incidental port.
