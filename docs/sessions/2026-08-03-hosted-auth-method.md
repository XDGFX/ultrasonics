# Session — 2026-08-03 — How a hosted account authenticates (map ticket 010)

Participants: Cal + Claude (Opus 5). Branch: `revival`.
Mode: `/wayfinder` → work the map → `/grilling` on ticket 010.

## What happened

Started by deleting the stale `operating-model` worktree at Cal's request — and it turned out to
matter. That worktree held commit `c192dcc`, the resolution of ticket 001, already pushed to
`origin/revival` but not merged into the local checkout. The map read at session start was one commit
stale and still described "tenant" and nine tickets. Verified the commit was safely on the remote,
removed the worktree, fast-forwarded local `revival`, and re-read the real map before choosing
anything. **Worth remembering: read the map from `origin/revival`, not the working copy.**

Then took **010 How a hosted account authenticates** — the map's own note flagged it as newly
critical, since it gates the schema (002) and ADR-0003 says the account table must never need a
retrofit.

## Decisions taken (now ADR-0008, Proposed)

- **Social OAuth only.** The grilling opened on the single dependency that separates the three
  mechanisms — is transactional email an acceptable hard launch dependency? Cal ruled it out.
  Passwords need email for reset, magic links make email *the* login path; only social OAuth needs no
  email infrastructure at all. Cal's second reason — never storing a credential — survives scrutiny:
  for login, nothing persists but a provider name and an opaque subject id.
- **Google alone at launch**, but Cal was explicit that one provider is not a comfortable resting
  place and wants several early, potentially including music services.
- **`accounts` carries no credential columns; a `federated_identities` join table holds identities**,
  1:many by construction. Cal's instinct was one OAuth per account and was unaware of services that
  link several — worth noting that Vercel, Linear and Notion all do, invisibly. Cal agreed to the
  join table anyway, which is the right call: with more providers expected early, columns-on-accounts
  would have meant a migration on the one table ADR-0003 protects.
- **Self-host gets no login wall at all.** This was the sharpest exchange. OAuth-only cannot serve a
  LAN self-hoster — providers reject private-network redirect URLs, so the flow has nowhere to
  terminate. Offered three ways out; Cal took the third: self-host doesn't need auth, anyone wanting
  it runs a trusted reverse proxy, and that's not ultrasonics' problem. Clean scope call.
- **Login identity is never a service connection.** Cal raised Spotify-as-login and reported the
  natural expectation that it would also connect Spotify for syncing — walking straight into the
  collision ADR-0007 renamed things to avoid. Settled: separate records, seeding permitted, dependency
  forbidden. Whether Spotify ships as a login provider at all is deferred; Cal was content to scope to
  conventional identity providers.

## The one design change the grilling produced rather than recorded

Cal proposed a `DISABLE_AUTH` flag that accepts or skips the middleware — and was careful to note it
was *not* the per-route guards ADR-0007 rejected. That was correct, and I overstated the gap on first
pass. But skipping the middleware still leaves `req.session` undefined in self-host, so handlers
either carry null checks or reach `WHERE account_id = undefined` and silently return the wrong rows —
the second code path re-entering through the session object rather than the guards.

Resolution keeps Cal's flag name and single switch, and moves the branch *inside* the middleware: it
selects the bootstrapped source instead of skipping. Self-host still never touches OAuth; `req.session`
is always populated. One flag, one branch, one code path.

## Map movement

- **010 closed.** 001 and 010 are now the two entries in Decisions so far.
- **002 unblocked** and handed its columns — no credential fields in any deployment mode. It is now
  the most valuable ticket on the map.
- **011 rescoped, not deleted.** It was written on ADR-0007's "frictionless is a default, not a
  ceiling" premise, which this decision withdraws. Narrowed to first-run bootstrap and proxy config.
- **012 created** — the identity-collision rule for provider #2. Deliberately not urgent (impossible
  while launch is Google-only) but must be settled *before* the second provider ships: auto-linking on
  provider email is an account-takeover vector dressed as a convenience feature.
- **ADR-0007 corrected in place** — its source table claimed the cookie source serves "any self-hoster
  who wants a real login", which OAuth-only makes untrue.
- **CONTEXT.md glossary updated** — `Session source` and `Login-free self-host` had the withdrawn
  framing; added `Login identity` and `Login identity ≠ service connection`.
- **Fog added:** which providers follow Google (and whether a service provider is ever one), and
  whether ultrasonics ever emails users for non-login purposes.
