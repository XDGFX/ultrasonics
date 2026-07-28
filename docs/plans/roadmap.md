# Roadmap

Living plan. Five phases, each with a hard **exit gate**; a phase isn't done until its gate is
green. Sequential where correctness demands it, parallel where work is independent. Every phase
boundary is a checkpoint for Cal (AGENTS.md). Update the **Status** lines as work lands.

Decisions this plan rests on: ADR-0001 (stack), 0002 (revenue), 0003 (multi-tenancy), 0004 (plugin
SDK), 0005 (auth), 0006 (preserve song dict + fuzzymatch).

---

## Phase 0 — Foundations & operating model
**Status:** in progress (docs) · **Owner mix:** mostly agents; Cal approves ADRs + SDK/auth contracts

Build the factory, not the product. Scaffold the Bun monorepo and CI. Freeze the plugin SDK
(ADR-0004) and `AuthProvider` (ADR-0005) as typed contracts *before* any plugin. Port the song dict
to Zod. Establish the docs system (this repo, done) and `AGENTS.md`.

**Exit gate:** CI green on an empty pipeline · SDK + `AuthProvider` interfaces frozen · song-dict
Zod schema + its tests merged · docs skeleton and ADRs 0001–0006 in place.

## Phase 1 — Vertical slice (prove the whole pipe)
**Status:** not started · **Owner mix:** agents build; Cal reviews the slice end-to-end

The make-or-break phase. Port **fuzzymatch** with **golden tests generated from v1** (ADR-0006),
the applet runner, one input (**Spotify**, BYO + PKCE), one output (**Plex**, via the PlexAPI-style
approach — the most-requested pairing in the issues), and a minimal Vue UI to build and run *one*
applet. Include the multi-tenant seams from day one (ADR-0003) but keep self-host login-free. Write
the v1 SQLite **importer**.

**Exit gate:** a real Spotify playlist syncs to Plex through the UI (`/verify`) · fuzzymatch golden
tests reproduce v1 output · importer reads a v1 `ultrasonics.db`.

## Phase 2 — Plugin parity (fan out)
**Status:** not started · **Owner mix:** heavily parallel — one worktree + agent per plugin

Port the rest against the proven SDK: deezer, lastfm, subsonic *(new)*, local-music-database,
local-playlists, playlist-merger, spotify-mixer, custom-file, log-tracks, webhook, time-trigger.
Decide **system-command**'s fate in a multi-tenant world before porting it. Each plugin is an
independent unit gated by the SDK **conformance test**. See `docs/reference/legacy-architecture.md`
for per-plugin behaviour and the parity matrix.

**Exit gate:** feature parity with v1 · every plugin passes conformance + a smoke test · parity
matrix in docs marked complete.

## Phase 3 — Beyond v1 (requested services + AI seams)
**Status:** not started · **Owner mix:** agents build; Cal prioritises from the issue backlog

Ship what people keep asking for and v1 never delivered: **YouTube Music** (#43), **Tidal** (#44),
**Apple Music** (#55). Reserve — don't fill — the AI seams: `matcher.strategy = "fuzzy" | "llm"`
and a natural-language playlist plugin. Opt-in only (ADR-0002).

**Exit gate:** ≥1 net-new service shipped · AI-seam interface merged (implementation deferred) ·
backlog issues triaged and linked.

## Phase 4 — Release & announce
**Status:** not started · **Owner mix:** agents draft; Cal presses publish

Multi-arch Docker image, a real docs site (v1's README admits documentation was "incomplete"), a
v1→v2 migration guide, and a 2.0 announcement to re-engage the 275 stargazers and open issues.

**Exit gate:** Docker image published · docs site live · migration guide tested against a real v1
install · release notes out.

## Phase 5 — Hosted tier (revenue)
**Status:** not started · **Owner mix:** agents build; Cal owns the business surface
**Early parallel track (start during Phase 1–2):** file Spotify extended-quota and Apple Developer
applications — real lead time (ADR-0002).

Turn the multi-tenant foundation into the hosted SaaS (ADR-0002): the `Proxy` `AuthProvider` with
ultrasonics-owned app credentials, accounts/billing (Stripe, subscription + freemium), deploy
infra, per-service **kill-switch** flags, and the marketing site. Launches **cloud-services-only**;
the **home agent** (A2 — CLI runner with remote dispatch) is a later addon.

**Exit gate:** hosted signup → connect Spotify → sync works end-to-end · Stripe subscription +
freemium gate live · kill-switch verified · commercial-API approvals in hand for launch services.

---

## Deferred / not yet decided

- Exact freemium tier limits (Phase 5 launch detail).
- Hosting/infra choice for the hosted tier.
- A2 home-agent dispatch protocol (NAT traversal, auth).
- Third-party plugin distribution/install story under explicit registration (ADR-0004).
- Product AI implementation (matcher `"llm"`, NL playlists) — seams only for now.
- Public-facing `README.md` rewrite — kept as-is until v2 is real to avoid misleading users.
