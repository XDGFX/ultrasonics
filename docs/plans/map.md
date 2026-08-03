# Wayfinder map — Phase 0 contracts

**Status:** Live — working Phase 0. 10 open tickets, 8 on the frontier (002, 003, 004, 006, 008,
009, 011, 012); 2 closed.

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

Concretely: the plugin SDK surface, the `AuthProvider` surface, the account model, and the
account-scoped database schema are all settled and written down. When no tickets remain, the way to
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

- [Account model](tickets/001-account-model.md) — one `Account`, 1:1 with the data it owns,
  permanently; **"tenant" retired**, everything scopes by `account_id`. Sessions are server-side rows
  behind an HTTP-only cookie, not JWT. Auth is never bypassed, only *sourced* (cookie / bootstrapped
  / trusted-proxy), all sources available in every deployment. Core receives pre-scoped capabilities,
  never an `accountId`. → [ADR-0007](../adr/0007-account-model-sessions-and-the-core-boundary.md)
- [How a hosted account authenticates](tickets/010-hosted-auth-method.md) — **social OAuth only**, no
  passwords, magic links or transactional email; **Google alone at launch**, more expected early.
  `accounts` carries no credential columns; identities live in a `federated_identities` join table,
  1:many by construction. **Self-host gets no login wall at all** (a LAN box cannot complete an OAuth
  callback) — trusted reverse proxy is the documented answer and supporting it is out of scope.
  `DISABLE_AUTH` selects the bootstrapped source *inside* the always-run middleware rather than
  skipping it. Login identity ≠ service connection: seeding allowed, dependency forbidden.
  → [ADR-0008](../adr/0008-hosted-authentication-social-oauth.md)

## Not yet specified

In scope, but not yet sharp enough to ticket. Graduates as the frontier advances.

- **The v1 SQLite importer's shape** — how far it maps v1's `ast.literal_eval` rows onto the new
  schema, and what it does with applets referencing dropped plugins. Needs
  [Account-scoped database schema](tickets/002-account-schema.md) first.
- **What the conformance test actually asserts** — the objective "is this plugin ported" bar
  (`CONTEXT.md`). Needs [Plugin SDK surface freeze](tickets/005-sdk-surface.md) first.
- **Scheduler architecture** — how the server owns recurring and webhook triggers once they no
  longer block. Needs [Trigger model](tickets/004-trigger-model.md) first.
- **Zod → settings-form generation** in `packages/web`. Needs the frozen SDK settings shape.
- **Which providers follow Google, and whether a *service* provider is ever one of them.** ADR-0008
  ships Google alone and fixes the rule that a login identity is never a service connection (seeding
  allowed, dependency forbidden) — but whether Spotify in particular is offered as a login at all is
  a product call Cal was content to defer, and the shortlist beyond Google is unsettled. The linking
  *rule* is already sharp and ticketed (012); this is the provider slate, which is not.
- **Whether ultrasonics ever emails users.** ADR-0008 removes email from the login path entirely, but
  sync-failure and expired-credential notifications are a plausible want. If it returns it is a new
  dependency on a non-critical path — not a reopening of the auth decision.

## Out of scope

Ruled beyond this map's destination. Never graduates; returns only if the destination is redrawn.

- **`system-command` plugin — dropped.** Arbitrary shell execution has no place in a hosted product
  many accounts share (ADR-0002/0003), and the self-host case is served by the webhook trigger plus the CLI
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
| 002 | ⛔ [Account-scoped database schema](tickets/002-account-schema.md) | grilling | 010 ✅ | **frontier** |
| 003 | [Plugin isolation mechanism](tickets/003-plugin-isolation.md) | research | — | **frontier** |
| 004 | [Trigger model and runner semantics](tickets/004-trigger-model.md) | grilling | — | **frontier** |
| 005 | ⛔ [Plugin SDK surface freeze](tickets/005-sdk-surface.md) | grilling | 003, 004 | blocked |
| 006 | ⛔ [AuthProvider surface freeze](tickets/006-authprovider-surface.md) | grilling | — | **frontier** |
| 007 | [Builder-time credentials for dynamic options](tickets/007-dynamic-options.md) | grilling | 005, 006 | blocked |
| 008 | [Monorepo conventions](tickets/008-monorepo-conventions.md) | grilling | — | **frontier** |
| 009 | [Triage the v1 issue backlog](tickets/009-issue-triage.md) | task | — | **frontier** |
| 011 | [Self-host first run and auth-mode config](tickets/011-self-host-first-run.md) | grilling | 010 ✅ | **frontier** (rescoped) |
| 012 | ⛔ [The identity-collision rule for provider #2](tickets/012-identity-collision-rule.md) | grilling | — | **frontier** |

Closed: **001 Account model**, **010 How a hosted account authenticates** → see Decisions so far.

010 closing unblocked **002** — the schema now has its account columns settled (no credential fields
at all) and is the most valuable ticket on the map: ADR-0003 says it must never need retrofitting.
**011 survived but narrowed** — its "frictionless is a default, not a ceiling" premise is withdrawn,
since self-host has no login wall on offer; what remains is first-run bootstrap and proxy config.
**012 is new** and deliberately not urgent: the collision rule cannot bite while launch is
Google-only, but it must be settled *before* provider #2 ships, because the friendly default
(auto-link on email) is an account-takeover vector.
