# Wayfinder map — Phase 0 contracts

**Status:** Live — working Phase 0. Counts and the frontier are not restated here; read them off the
[ticket table](#tickets) below, which is the only copy.

The decision map. `roadmap.md` says *what* to build and when; `../../AGENTS.md` says *how* work is
dispatched and gated. **This says what is still undecided** — and nothing else. A decision lives in
exactly one place, its ticket in `tickets/`; this file only gists and links.

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
corpus — is *not* on this map. It is already unambiguous and lives in `roadmap.md`.

## Notes

- **Domain:** `../../CONTEXT.md` is the glossary; use its terms exactly. Accepted decisions are in
  `../adr/` — a ticket may not re-litigate one, only supersede it with a new ADR.
- **Skills every session should consult:** `/grilling` and `/grill-with-docs` for the HITL tickets,
  `/research` for the AFK ones.
- **A resolved ticket that decided something non-obvious gets an ADR** (AGENTS.md). The ticket
  records the reasoning; the ADR records the decision.
- **Standing preference:** prefer the smallest contract that serves Phase 1. Anything the hosted
  tier needs but the vertical slice does not is out of scope here — a seam, not an implementation.

## Decisions so far

<!-- one line per closed ticket: enough to judge relevance, then open the ticket for the detail -->

- [Account model](tickets/001-account-model.md) — one `Account`, 1:1 with its data, permanently;
  "tenant" retired for `account_id`; server-side sessions; core gets capabilities, never identity.
  → [ADR-0007](../adr/0007-account-model-sessions-and-the-core-boundary.md)
- [How a hosted account authenticates](tickets/010-hosted-auth-method.md) — social OAuth only, Google
  at launch; no credential columns on `accounts`; self-host gets no login wall at all.
  → [ADR-0008](../adr/0008-hosted-authentication-social-oauth.md)
- [Account-scoped database schema](tickets/002-account-schema.md) — relational SQLite with JSON
  columns (Mongo rejected), Drizzle, scoping enforced in the query layer by a scoped store behind a
  lint rule; credentials always encrypted; migrations auto-apply on boot.
  → [ADR-0009](../adr/0009-database-schema-drizzle-sqlite-and-migrations.md)
- [Plugin isolation mechanism](tickets/003-plugin-isolation.md) — boundary designed Worker-shaped
  now, plugins run in-process in Phase 1 behind a `PluginExecutor` seam; deferred on Bun's maturity,
  not cost. Price is nine day-one SDK constraints on 005.
  → [ADR-0010](../adr/0010-plugin-isolation-worker-shaped-boundary-in-process-phase-1.md)
- [Plugin SDK surface freeze](tickets/005-sdk-surface.md) — `component` becomes the keying axis:
  `instanceSettings` a static record and `run` one handler per component, the `component`
  declaration derived from `run`'s keys, the registry a `name → {path, load()}` record, `test()`
  returning plain data rather than throwing. Auth boundary: if you cannot connect without it, it is
  auth, not a setting. → [ADR-0012](../adr/0012-plugin-sdk-surface-keyed-by-component.md)
- [Which triggers are worth having](tickets/014-trigger-candidates.md) — every candidate worth
  building (schedule, inbound webhook, outbound webhook, run-now) is a **server capability needing no
  plugin apparatus**; Home Assistant/Node-RED/IFTTT/Zapier all collapse into one inbound webhook;
  service events ("new album") are polling-only and cost-prohibitive; nobody ever used v1's webhook,
  which has been broken since Mar 2022. Findings, not a decision — 004 owns the call.
  → [research](../reference/trigger-candidates-research.md)
- [Trigger model and runner semantics](tickets/004-trigger-model.md) — **a Trigger is not a plugin**;
  the `Trigger` Component is removed and the SDK freezes at three (`inputs`/`modifiers`/`outputs`).
  Triggers become server-owned applet config: a schedule and/or an authenticated inbound webhook.
  Combination is **OR**, hardcoded (the AND bug dissolves rather than being fixed); a firing during a
  run **queues at depth one**, concurrency allowed across different applets.
  → [ADR-0011](../adr/0011-triggers-are-server-capabilities-not-plugins.md)
- [AuthProvider surface freeze](tickets/006-authprovider-surface.md) — a grant belongs to a
  `service` (two plugins declaring the same one share it, by design) and its shape is a declared Zod
  `fields` object, so `serverUrl`/`apiKey` leave the flow vocabulary as `token` flows; `Credentials`
  is inferred and `ctx.auth.get()` takes no arguments; five methods, adding the `configure()` the
  draft lacked for the offline paste path; refresh is lazy inside `resolve()`; the reconnect surface
  is built host-side. Found that v1's Last.fm key came from the **dead proxy**, so it never had a
  working BYO path.
  → [ADR-0013](../adr/0013-authprovider-surface-service-grants-and-declared-fields.md)
- [Monorepo conventions](tickets/008-monorepo-conventions.md) — **a filename suffix earns its keep
  only when something mechanical reads it**, so the taxonomy is rejected and `*.test.ts` is the only
  suffix; the package `exports` field is the real module boundary. Biome replaces ESLint+Prettier;
  the cycle gate becomes two gates and loses its rebaseline hatch (a roadmap amendment). Also
  decided, though not on the ticket: one package per plugin, and no tsconfig project references in
  Phase 0. → [ADR-0014](../adr/0014-monorepo-conventions-naming-boundaries-and-gates.md)
- [Builder-time credentials for dynamic options](tickets/007-dynamic-options.md) — **deferred past
  Phase 1**, static settings only; v1's sole dynamic list was Plex's library sections and it never
  had a playlist picker. Plex takes an optional free-text `library` (empty = the only music library;
  title or id), and an unresolvable one fails the run listing the server's libraries. No ADR.
- [Triage the v1 issue backlog](tickets/009-issue-triage.md): all 37 open issues are bucketed (13
  die with v1, 16 to preserve, 4 Phase 3, 4 uncertain), along with eleven **must-still-work
  behaviours** to lift into specs. Labels are applied, and the 14 dead issues
  are closed with comments. Surfaced 017.
  → [triage](../reference/v1-issue-triage.md)
- [Self-host first run and auth-mode config](tickets/011-self-host-first-run.md): security
  properties are never silently defaulted (house style). `AUTH_SOURCE=bootstrapped|proxy|oauth` is
  required and replaces `DISABLE_AUTH`. The account is created at boot in every mode. A trusted
  proxy is listed by CIDR and authorises without identifying. Exposure gets a warning, not a block.
  One account per install. → [ADR-0015](../adr/0015-self-host-first-run-and-the-auth-source-switch.md)
- [The identity-collision rule for provider #2](tickets/012-identity-collision-rule.md): no
  auto-linking, ever. Settings is the only way to add an identity. A sign-in whose verified email
  collides is blocked, with a hint naming the original provider. No merges, and never zero
  identities. Link and unlink need a sign-in within the last 10 minutes. Adds
  `federated_identities.email` and `sessions.authenticated_at`.
  → [ADR-0016](../adr/0016-identity-linking-and-the-collision-rule.md)
- [The v1 importer's shape](tickets/013-v1-importer-shape.md): automatic and once, at the first
  self-host boot. It reads v1's database read-only with a small TypeScript `repr` parser. Applets
  import disabled; an unknown plugin skips its applet, with a report. Only Plex credentials survive,
  because Spotify's and Deezer's tokens belong to the dead proxy's app. Each plugin's v1 mapping is
  part of its Phase 2 port, which amends that phase's exit gate.
  → [ADR-0017](../adr/0017-the-v1-importer.md)

## Not yet specified

In scope, but not yet sharp enough to ticket. Graduates as the frontier advances.

- **What the conformance test actually asserts** — the objective "is this plugin ported" bar
  (`CONTEXT.md`). **Partly cleared, not gone:** ADR-0012 §8 fixed three machine-checked invariants
  (run/`instanceSettings` key parity, plus ADR-0010's `structuredClone` and lost-methods checks), and
  `plugin-sdk-v2.md` lists the rest as prose. What remains fog is whether that prose list is
  sufficient to call a port done — chiefly what "inputs return a schema-valid song dict" demands in
  practice, and whether the renderable-schema subset (016) is asserted here too. **Evidence from
  [009](tickets/009-issue-triage.md):** v1 shipped an input that emitted the wrong key (#59). A type
  can't catch bad data from a service, which argues for Zod-parsing the song dict at each plugin
  boundary at run time.
- **Account-level BYO client credentials.** ADR-0013 §7 ships operator-level only for Phase 1 (one
  registered app per service per instance, in `instance_settings`). Account-level is **deferred, not
  ruled out** — `plugin_settings` already exists so no migration is needed, and it is the natural
  fallback if the Spotify platform-access wall found by [014](tickets/014-trigger-candidates.md)
  bites the hosted tier. Sharpens into a ticket when that wall is reconfirmed, or when the hosted
  tier opens.
- **More than one grant for the same service.** ADR-0013 keys a grant `(account_id, service)`, so
  one self-host account can't sync a second, separate Spotify account. Only one user has asked (on
  PR #45, found by [009](tickets/009-issue-triage.md)), but it's a gap with no workaround, not a
  rough edge. At minimum, ADR-0013 should name it as a known limitation.
- **Whether the auth setup wizard shares 016's renderer.** ADR-0013 gives the wizard a typed
  contract (`requirements()` plus the declared `fields` schema), but not a renderer. It may collapse
  into [016](tickets/016-settings-form-generation.md) rather than becoming its own ticket — 016
  should decide that when it is worked, not before.
- **Dynamic option lists (pickers)** — "pick from your playlists" instead of a regex or title field.
  Deferred by [007](tickets/007-dynamic-options.md): wanted as a v2 improvement, not before parity.
  Known shape: an optional, additive hook keyed by component and field (`instanceSettings` stays
  static, ADR-0012), which needs a second `PluginExecutor` entry point, a builder context for
  `resolve()`, a rule for when credentials are missing, and caching. Graduates once parity is reached.
- **Notifications** — whether ultrasonics ever tells a user something happened, by any channel. The
  **outbound webhook on sync completion** belongs here (deferred by ADR-0011, and 014 found it has
  the *better* demand signal of the two webhook directions), as does email, below. So does the
  **"a new sign-in method was added" alert**, the standard takeover alarm that ADR-0016 left
  without a channel.
- **Which providers follow Google, and whether a *service* provider is ever one of them.** ADR-0008
  ships Google alone and fixes the rule that a login identity is never a service connection (seeding
  allowed, dependency forbidden) — but whether Spotify in particular is offered as a login at all is
  a product call Cal was content to defer, and the shortlist beyond Google is unsettled. The linking
  *rule* is decided (ADR-0016); this is the provider slate, which is not.
- **Whether ultrasonics ever emails users.** ADR-0008 removes email from the login path entirely, but
  sync-failure and expired-credential notifications are a plausible want. If it returns it is a new
  dependency on a non-critical path — not a reopening of the auth decision.

## Out of scope

Ruled beyond this map's destination. Never graduates; returns only if the destination is redrawn.
**Do not ticket these here.** The reasoning lives in
[`roadmap.md`](roadmap.md#deferred--not-yet-decided) — this is a boundary marker, not a second copy:

- **`system-command`** — dropped, not ported (`roadmap.md` § Dropped).
- **Third-party plugin install story** — no third-party plugin exists yet.
- **Subsonic** — net-new rather than a port; roadmap Phase 3.
- **Hosted-tier decisions** — freemium limits, hosting/infra, A2 dispatch, the `Proxy`
  `AuthProvider`; roadmap Phase 5. ⚠️ **Carry this forward when the phase opens:** research for
  [014](tickets/014-trigger-candidates.md) turned up a **Spotify platform-access wall** — development
  mode capped at a handful of users, extended quota requiring a registered business above a high MAU
  threshold. A *permission* wall, not a rate limit, so it bears on ADR-0002 and on whether `Proxy` is
  viable for Spotify at all. BYO self-host is unaffected. Figures are second-hand and must be
  reconfirmed against Spotify's own developer terms before anything rests on them.
- **Product AI implementation** — seam reserved in `CONTEXT.md`, filled post-parity.
- **Public `README.md` rewrite** — roadmap Phase 4.
- **Adopting `WorkerExecutor`** — ADR-0010 freezes the boundary; performing the swap is Phase 2
  execution (`roadmap.md`).

---

## Tickets

Frontier = open, unblocked, unclaimed. ⛔ marks a checkpoint gate (`../../AGENTS.md`):
Cal accepts the resolution before it counts as decided.

| # | Ticket | Type | Blocked by | Status |
|---|---|---|---|---|
| 015 | [Scheduler architecture](tickets/015-scheduler-architecture.md) | grilling | 004 ✅ | **frontier** (graduated) |
| 016 | [Zod → settings-form generation](tickets/016-settings-form-generation.md) | grilling | 005 ✅ | **frontier** (graduated) |
| 017 | ⛔ [Does an output report what it did?](tickets/017-output-run-report.md) | grilling | 009 ✅ | **frontier** (new) |

Closed tickets are not listed here — they are **Decisions so far** above.

**A standing caution for every session on this map.** Twice now an agent's paraphrase has hardened
into a constraint nobody agreed to — "tenant" (caught in 001) and a self-host "no setup promise"
(caught in 002, where it had been about to justify a weaker security default). Before leaning on a
stated constraint, check its wording in the source ADR. Constraints that argue *for* the cheaper
option deserve the most scrutiny.

Per-ticket context — what a resolution handed to which ticket, and why a ticket is narrowed or not
urgent — is written on the tickets themselves, not here.
