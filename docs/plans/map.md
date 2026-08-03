# Wayfinder map — Phase 0 contracts

**Status:** Live — charting Phase 0. 9 open tickets, 5 on the frontier (001, 003, 004, 008, 009).

The decision map. `roadmap.md` says *what* to build; `operating-model.md` says *how* work is
dispatched; `wave-board.md` says *where execution is right now*. **This says what is still
undecided** — and nothing else. A decision lives in exactly one place, its ticket in `tickets/`;
this file only gists and links.

Tickets are markdown under `tickets/`, one per decision. This is wayfinder's local-markdown
tracker — chosen over GitHub issues deliberately: `XDGFX/ultrasonics` is public with 275 stars and
40+ real user bug reports, and internal planning tickets would both leak and drown them.

---

## Destination

**Phase 0 complete: every contract Phase 1 depends on is frozen**, so the vertical slice
(Spotify → Plex through the UI) can be built without stopping to decide anything.

Concretely: the plugin SDK surface, the `AuthProvider` surface, the account/tenant model, and the
tenant-scoped database schema are all settled and written down. When no tickets remain, the way to
Phase 1 is clear.

Execution that follows those decisions — scaffolding, the song-dict port, the fuzzymatch golden
corpus — is *not* on this map. It is already unambiguous and lives on the wave board.

## Notes

- **Domain:** `../../CONTEXT.md` is the glossary; use its terms exactly. Accepted decisions are in
  `../adr/` — a ticket may not re-litigate one, only supersede it with a new ADR.
- **Skills every session should consult:** `/grilling` and `/grill-with-docs` for the HITL tickets,
  `/research` for the AFK ones. See `operating-model.md` §5 for the skill→gate map.
- **A resolved ticket that decided something non-obvious gets an ADR** (AGENTS.md). The ticket
  records the reasoning; the ADR records the decision.
- **Standing preference:** prefer the smallest contract that serves Phase 1. Anything the hosted
  tier needs but the vertical slice does not is out of scope here — a seam, not an implementation.

## Decisions so far

<!-- one line per closed ticket: enough to judge relevance, then open the ticket for the detail -->

*None yet — the map was charted 2026-08-03.*

## Not yet specified

In scope, but not yet sharp enough to ticket. Graduates as the frontier advances.

- **The v1 SQLite importer's shape** — how far it maps v1's `ast.literal_eval` rows onto the new
  schema, and what it does with applets referencing dropped plugins. Needs
  [Tenant-scoped database schema](tickets/002-tenant-schema.md) first.
- **What the conformance test actually asserts** — the objective "is this plugin ported" bar
  (`CONTEXT.md`). Needs [Plugin SDK surface freeze](tickets/005-sdk-surface.md) first.
- **Self-host first-run UX** — bootstrap, auto-login, the `DISABLE_AUTH` / trusted-proxy escape
  hatch. Shape depends on [Account and tenant model](tickets/001-account-model.md).
- **Scheduler architecture** — how the server owns recurring and webhook triggers once they no
  longer block. Needs [Trigger model](tickets/004-trigger-model.md) first.
- **Zod → settings-form generation** in `packages/web`. Needs the frozen SDK settings shape.

## Out of scope

Ruled beyond this map's destination. Never graduates; returns only if the destination is redrawn.

- **`system-command` plugin — dropped.** Arbitrary shell execution has no place in a multi-tenant
  product (ADR-0002/0003), and the self-host case is served by the webhook trigger plus the CLI
  runner. Not ported; if it ever returns it is a fresh decision with its own ADR.
- **Third-party plugin install story** under explicit registration (ADR-0004) — no third-party
  plugins exist yet; decide when one does.
- **Subsonic** — net-new, not a port. Belongs with the other new services in roadmap Phase 3.
- **Hosted-tier decisions** — freemium limits, hosting/infra, the A2 home-agent dispatch protocol,
  the `Proxy` `AuthProvider` implementation. Roadmap Phase 5.
- **Product AI implementation** (matcher `"llm"`, NL playlists) — the seam is reserved in
  `CONTEXT.md`; filling it is post-parity.
- **Public `README.md` rewrite** — deliberately stale until v2 is real (roadmap Phase 4).

---

## Tickets

Frontier = open, unblocked, unclaimed. ⛔ marks a checkpoint surface (`operating-model.md` §4):
Cal accepts the resolution before it counts as decided.

| # | Ticket | Type | Blocked by | Status |
|---|---|---|---|---|
| 001 | ⛔ [Account and tenant model](tickets/001-account-model.md) | grilling | — | **frontier** |
| 002 | ⛔ [Tenant-scoped database schema](tickets/002-tenant-schema.md) | grilling | 001 | blocked |
| 003 | [Plugin isolation mechanism](tickets/003-plugin-isolation.md) | research | — | **frontier** |
| 004 | [Trigger model and runner semantics](tickets/004-trigger-model.md) | grilling | — | **frontier** |
| 005 | ⛔ [Plugin SDK surface freeze](tickets/005-sdk-surface.md) | grilling | 003, 004 | blocked |
| 006 | ⛔ [AuthProvider surface freeze](tickets/006-authprovider-surface.md) | grilling | 001 | blocked |
| 007 | [Builder-time credentials for dynamic options](tickets/007-dynamic-options.md) | grilling | 005, 006 | blocked |
| 008 | [Monorepo conventions](tickets/008-monorepo-conventions.md) | grilling | — | **frontier** |
| 009 | [Triage the v1 issue backlog](tickets/009-issue-triage.md) | task | — | **frontier** |

Resolution order is not fixed — take any frontier ticket. But 001 unblocks two ⛔ tickets and is
the deepest dependency on the map; it is the natural first.
