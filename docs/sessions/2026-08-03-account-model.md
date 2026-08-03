# Session — 2026-08-03 — Account model (map ticket 001)

Participants: Cal + Claude (Opus 5). Branch: `revival` (committed directly, per `AGENTS.md`
"Branching" — sequential docs work needs no branch or PR).
Mode: `/wayfinder` → work the map → `/grilling` on ticket 001.

## What happened

Took the map's deepest dependency, **001 Account and tenant model**, and grilled it to a resolution.

The session turned on its first exchange. Asked to rule on account/tenant cardinality, Cal's
response was that they did not know what a tenant was or where it had come from — they remembered
grilling the *login* question (hosted needs it, self-host must not be walled), but nothing beyond
that. Checking the provenance: the 28 July kickoff records Cal grilling revenue and product shape,
and ADR-0003's Context does reflect a real conversation. **The decision was Cal's; the word "tenant"
was an agent's write-up choice** that then propagated unchallenged into `CONTEXT.md` and three
tickets.

So the resolution does two things: it answers the four questions the ticket posed, and it retires
the term.

## Decisions taken (now ADR-0007, Proposed)

- **One entity, `Account`** — person and data-owner are the same thing, 1:1, permanently. One hosted
  subscription = one login, forever; a shared household sync is not a case ultrasonics serves. No
  membership join held open on spec. **"Tenant" retired**; everything scopes by `account_id`.
- **Server-side sessions**, opaque HTTP-only cookie, not JWT — one server owning its own database
  gets nothing from stateless verification and loses instant revocation.
- **Auth is never bypassed, only sourced** — one middleware always resolves a `Session` from a cookie
  login, the bootstrapped account, or a trusted-proxy header. Cal's refinement: **all three available
  in every deployment**; self-host defaults to frictionless, but that is a default, not a ceiling —
  a self-hoster wanting a real login wall changes config, not builds. `DISABLE_AUTH` route-guard
  no-ops rejected as a second code path.
- **Core receives capabilities, never identity** — no core function takes an `accountId`; the server
  hands it pre-scoped objects. Cross-account leakage becomes structurally impossible instead of a
  rule every query must remember.

## Artifacts

- `docs/adr/0007-account-model-sessions-and-the-core-boundary.md` (**Proposed** — needs Cal's accept).
- Ticket 001 closed with its resolution; 002 renamed `002-account-schema.md` and retitled.
- New tickets **010** (how a hosted account authenticates) and **011** (self-host first run +
  auth-mode config, graduated from the map's fog).
- "Tenant" scrubbed from all *live* docs: `CONTEXT.md`, map, roadmap, wave board, operating model,
  both proposals, `docs/README.md`. **Accepted ADRs and past session notes left untouched** as
  historical records — ADR-0007 carries a read-across note instead (`AGENTS.md`: don't rewrite
  accepted ADRs, supersede or refine them).
- `TenantContext` removed from the draft signatures in `plugin-sdk-v2.md` and `auth-provider-v2.md`.

## Map state

Closed 001. **006 is unblocked** (it only ever waited on the account model). **010 is on the frontier
and now gates 002**, since what the `accounts` table stores depends on how people sign in. Frontier:
003, 004, 006, 008, 009, 010.

## Next concrete steps

1. Cal accepts (or amends) ADR-0007 — it is `Proposed` and 002/006/010 all build on it.
2. Take **010** next: it gates the schema, the most expensive thing on the map to get wrong.
3. **003** (plugin isolation) is AFK and still unstarted — a `/research` subagent can run it in
   parallel with any HITL ticket. Not fired this session.

## Carried forward

- ADR-0007 is `Proposed`, not `Accepted`.
- Lesson worth keeping: agent-authored write-ups can introduce vocabulary the owner never chose.
  Worth a provenance check when a term feels unfamiliar rather than assuming it was settled.
