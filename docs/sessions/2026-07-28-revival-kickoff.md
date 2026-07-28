# Session — 2026-07-28 — Revival kickoff

Participants: Cal + Claude (Opus 4.8). Branch: `revival` (off `master`).

## What happened

Analysed dormant v1 (Python/Flask, ~1,200 LOC engine, ~16 plugins, 275★, still attracting issues
in 2026). Decided to revive as a TS/Bun/Vue rewrite run largely by AI agents. Grilled the revenue
and product-shape questions to a shared conclusion, then scaffolded the documentation system
modelled on the `strategic-success` repo's conventions.

## Decisions taken (now ADRs)

- **0001** TS/Bun/Vue monorepo rewrite (not a Python modernisation).
- **0002** Open-core + hosted SaaS revenue tier. Free self-host stays full-featured; paid = fully
  hosted ("A1"), launching cloud-services-only; home-agent ("A2") for Plex-from-cloud is a later
  addon. Ship all services in hosted, gate reactively via a per-service kill-switch. Subscription +
  freemium via Stripe. Hosted is roadmap Phase 5; only the commercial-API applications start early.
- **0003** Full multi-tenancy from day one, same code both ways; self-host stays login-free by
  default. Pulls accounts/auth forward into Phase 0–1.
- **0004** Typed plugin SDK, explicit registration (no dynamic import).
- **0005** `AuthProvider` abstraction (BYO default / PKCE / Proxy); `ultrasonics-api` proxy retired.
- **0006** Port the song dict and fuzzymatch verbatim; pin with golden tests from v1.

## Artifacts produced this session

- `AGENTS.md`, `CLAUDE.md` (→ `@AGENTS.md`), `CONTEXT.md` (domain glossary).
- `docs/` system: `README.md` index, ADRs 0001–0006, `plans/roadmap.md`, `proposals/plugin-sdk-v2.md`,
  `reference/legacy-architecture.md` (v1 engine, fuzzymatch source-of-truth, full plugin catalogue +
  parity matrix).
- External: revival plan artifact (strategy doc), shared separately.

## State

**Documentation only** — no code yet, by intent. Repo is on branch `revival`, first docs commit.

## Next concrete steps

1. **`/grill-with-docs` the plugin SDK** (`proposals/plugin-sdk-v2.md` open questions) → freeze the
   SDK + `AuthProvider` contracts. Phase 0 gate.
2. Scaffold the Bun monorepo (`packages/*` per ADR-0001) — factory only, no product code.
3. Port the song dict to Zod + tests; generate the fuzzymatch golden corpus from a v1 checkout.
4. File Spotify extended-quota + Apple Developer applications (early parallel track, ADR-0002).

## Open questions carried forward

- SDK open questions in `proposals/plugin-sdk-v2.md` (dynamic option fetching, plugin isolation
  mechanism, third-party install, trigger model).
- `system-command` plugin's place in a multi-tenant hosted world.
- Public `README.md` rewrite deferred until v2 is real.
