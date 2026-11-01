# ADR-0028 — The database is its own package, with a narrow system module

**Status:** Proposed
**Date:** 2026-11-01
**Refines:** ADR-0001 (which put persistence in `packages/server`), ADR-0009 §4 (which named two
data-access modules)
**Spec:** the Phase 1 database spec, map [Phase 1 specs](https://github.com/XDGFX/ultrasonics/issues/100)

## Context

ADR-0009 §4 makes the raw Drizzle connection private to the database directory, guarded by a lint
rule. ADR-0014 later found that a package's `exports` field is the only boundary actually enforced.
The runner in `packages/core` also writes run records, and depending on `packages/server` for the
store would invert the layering.

ADR-0009 §4 also named two modules: the scoped store, and a narrow auth store for the session
middleware and login routes. Four Phase 1 queries fit neither, because they have no account yet:
the scheduler's due-applets query, resolving a webhook token, marking `running` runs `interrupted`
at boot, and sweeping expired sessions.

## Decision

**Persistence is `packages/db`.** Its `exports` offer only the open step, `storeFor(accountId)`,
the narrow modules and the types. The raw connection has no export, so nothing outside the
package can reach it.

**A third narrow module, the system module**, serves boot, the scheduler and the webhook route.
Each method returns account and applet ids or counts, never another account's data. Callers then
call `storeFor(accountId)`. The auth store keeps ADR-0009's scope.

The two narrow modules are separate subpath exports. A lint rule allows each one only in the server
files that need it, so an import anywhere else fails in CI rather than relying on review.

**The applet `definition` column** is `{ inputs, modifiers, outputs }`. Each is an ordered list of
`{ plugin, settings }` slots, with at least one input and one output. `settings` is stored raw and
checked against the plugin's schema by the server (ADR-0019 §7). A slot is addressed by component
and index.

## Considered options

- **Persistence inside `packages/server`**, as ADR-0001 sketched. Rejected: only the lint rule
  would keep the raw connection private, and the runner would have to declare its own copy of the
  run-record interface.
- **Cross-account queries in the auth store.** Rejected: it widens a module ADR-0009 kept to session
  resolution, and an auth-store import in the scheduler would look legitimate in review.
