# 2026-08-07 — Monorepo conventions (map ticket 008)

/ wayfinder, working the map. One ticket resolved.

## Ticket selection

`revival`'s frontier starts at **006**, but 006 is already resolved on
`worktree-wayfinder-006-authprovider` (commit `bca58ac`, ADR-0013) and **not merged to trunk**. The
worktree is locked, so a session is live on it. Skipped it and took the next unclaimed frontier
ticket, **008**.

This is the second session running to hit the same hazard, and the 2026-08-06 log called it: *a
wayfinder session that commits to its worktree and stops leaves trunk lying to the next session about
where the frontier is.* Last time it cost a fast-forward; this time it nearly cost a duplicated
resolution of a checkpoint-gate ticket. Worth a mechanical fix rather than a third note.

## Done

**Ticket 008 — Monorepo conventions — resolved** → ADR-0014, agreed by Cal in-session.

The organising idea, and the bit that generalises past this repo: **a filename suffix earns its keep
only when something mechanical reads it.** Three tiers — machine-load-bearing, glob-targetable with a
glob that actually exists, and purely descriptive. Only the first is worth adopting.

1. **Suffix taxonomy — rejected**; `*.test.ts` only, files named for the concept they hold.
2. **Boundaries** — the package `exports` field is the real one (resolver-enforced);
   `noPrivateImports` is left on as a default, explicitly *not* a wall.
3. **Biome** replaces ESLint + Prettier. `.vue` out of scope until `packages/web` has files.
4. **Two cycle gates**, and the `cycle-check:update` rebaseline hatch **retired** — a roadmap
   amendment, not a silent divergence.
5. **Colocated `*.test.ts`**, test data in `test/fixtures/`.
6. **`.claude/settings.json`** — the deny list is the substance; it makes the read-only-issues rule
   machine-checked.
7. **One package per plugin** (not on the ticket; ADR-0001 left it open).
8. **Shared base tsconfig, no project references in Phase 0** (likewise).

### What decided it

Cal came in leaning *towards* the suffix taxonomy and asked for it properly evaluated rather than
asserted, explicitly to reuse the conclusion on future projects. Two things turned it:

- **Why the taxonomy looks better than it is.** It is admired because of where it is seen working —
  Angular, NestJS — and there it is machine-load-bearing: the CLI generates on those names, DI
  resolves by them. Transplanted to a plain TS monorepo the identical names are purely descriptive.
  The visible pattern travels; the mechanism that justified it does not.
- **Two candidates fell to repo-specific evidence rather than taste.** `*.interface.ts` contradicts
  the Zod-inferred-type convention — the interface here *is a runtime value*, so a type-only file for
  it would sit empty or invite the duplicate type `AGENTS.md` forbids. And `*.utils.ts` has this
  repo's own cautionary tale: v1's `ultrasonics/tools/` is exactly that folder, and it is where 006
  found the dead `api_key` proxy that had been silently breaking Last.fm for years.

Rejecting the taxonomy then had to *pay back* the discoverability it was offering, which is where the
`exports`-field boundary came from — the same intent, machine-checked instead of described.

### A fact-check that changed a decision mid-session

I told Cal in round 1 that Biome's `noImportCycles` had a monorepo blind spot around workspace
packages. Wrong — the documented gap is the package.json `imports` field (`#lib/*`), which we need
not adopt. Corrected in round 2 before it hardened. Separately, I promised the `index.ts` boundary
would be enforced by a lint rule; checking `noPrivateImports` showed it needs per-symbol `@package`
JSDoc and skips alias imports, so the claim was downgraded to "default, not a wall" and `exports`
became the load-bearing half. Both corrections are in ADR-0014 §2 at the weaker strength on purpose.

### Also touched

- `AGENTS.md` — five convention one-liners; `check`/`check:ci` split; the `build-process.md` pointer
  widened to say it now holds the scaffold detail.
- `docs/build-process.md` — new **Scaffold conventions** section: scripts table, the two cycle gates
  and the suppression convention, the permission allowlist.
- `docs/plans/roadmap.md` — Phase 0 scaffold brief amended (rebaseline hatch retired, conventions
  pointed at ADR-0014).
- Map — 008 into Decisions-so-far and out of the ticket table.

No fog graduated: 008 touched none of the four **Not yet specified** entries.

## Next

**006 landed while this session was writing up** — pushed to `origin/revival` by the session that
held its worktree, which diverged trunk from this work by one commit each way. Rebased onto it; the
only conflict was the ticket table, where both sides had deleted a different row. Resolution was the
union of both deletions, with 007 taking 006's unblocking.

Frontier on trunk is now **007, 009, 011, 012, 013, 015, 016**. With 006 done, **every Phase 0
contract in the destination is frozen** — SDK surface, `AuthProvider`, account model, schema. What
remains on the map is not contract work.

**007 is the one to take next.** It is freshly unblocked, and ADR-0013 narrowed it before it started:
`ctx.auth.get()` is a fixed zero-argument typed getter, so builder-time option fetching must not
widen it.

**009 is the only AFK ticket left** — worth dispatching as a background job rather than spending a
live session on it.

## Watch out for

**Three sessions, three unmerged-worktree incidents — and this one turned into a real collision.**
Two sessions resolved different tickets against the same trunk and both edited the map's ticket
table; nothing was lost, but only because the conflict happened to be textual. Had both sessions
touched the *same* row the merge would have been silent and wrong. The hazard is now well enough
evidenced to fix mechanically rather than warn about a fourth time: a wayfinder session should check
its worktree branch against trunk before picking a ticket, and rebase before writing up. Flagging
rather than doing, since it is tooling work and Phase 0's map is nearly empty.

**ADR-0014 is `Proposed`.** 008 is not a checkpoint-gate ticket so Cal's in-session agreement settles
the decision, but the ADR still wants its status moved to `Accepted` in the normal course.

**Two decisions were taken that the ticket did not ask for** (one package per plugin; no project
references). Both matched 008's own test — cheap now, expensive once six packages exist — and both
were put to Cal explicitly as out-of-ticket before being taken. Recorded here so a later reader does
not find them in ADR-0014 and wonder where they came from.
