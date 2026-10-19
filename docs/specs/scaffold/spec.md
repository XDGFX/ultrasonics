# Spec — Phase 0 scaffold cell

**Status:** resolved

**Sources:** `docs/plans/roadmap.md` § Phase 0 ("The scaffold cell must deliver"), ADR-0001 (stack
and layout), ADR-0014 (naming, boundaries, gates, scripts, permissions), `docs/build-process.md`
§ Scaffold conventions. Nothing here re-decides those; where this spec adds a decision, it says so.

## Problem Statement

The revival is documentation only. Every contract Phase 1 depends on is frozen, but no code can land
yet: there is no Bun workspace to put a package in, no linter, no type-checker and no CI to tell an
agent that its work is red. The quality gate in `AGENTS.md` is labelled "aspirational" for exactly
that reason. The next cells (the song dict in Zod, then the fuzzymatch golden corpus) would each
have to improvise tooling as they went, which is what ADR-0014 exists to prevent. Agent waves would
also run without the permission allowlist, so they would either stall on prompts or work with no
machine-checked guard against touching the 40+ real user issues on the public repo.

## Solution

One cell builds the factory and leaves it empty. When it lands:

- the repo root is a Bun workspace that accepts packages under `packages/` and `packages/plugins/`
  without any further root changes;
- `bun run check` repairs and type-checks locally, `bun run check:ci` fails rather than repairs, and
  `bun run test` runs the suite;
- CI runs the read-only gate and the tests on every PR and every direct push to `revival`, and is
  green with zero feature packages;
- both import-cycle gates exist (Biome inside a package, a workspace-graph script across packages)
  and each one demonstrably fails on a planted violation;
- `.claude/settings.json` allows the routine commands and denies the unrecoverable ones.

The v1 Python tree stays exactly where it is, because later Phase 0 and Phase 1 cells need it to run.

## User Stories

1. As a cell agent, I want a Bun workspace at the repo root, so that I can add a package by creating
   its directory and `package.json` without editing root configuration.
2. As a cell agent, I want the workspace to cover both `packages/*` and `packages/plugins/*`, so
   that a Phase 2 plugin port lands in its own package (ADR-0014 §6) with no root change.
3. As a cell agent, I want a shared base TypeScript configuration in strict mode, so that each new
   package extends it in one line and inherits the same strictness.
4. As a cell agent, I want no TypeScript project references to maintain, so that adding a package
   never means editing a root list that rots silently (ADR-0014 §7).
5. As a cell agent, I want `bun run check` to format, lint-fix and type-check in one command, so
   that I can get my work into shape before committing.
6. As a cell agent, I want `bun run check:ci` to run the same gates read-only, so that I see exactly
   the verdict CI will give, without anything being silently repaired.
7. As a cell agent, I want `bun run test` to run every `*.test.ts` in the workspace with `bun:test`,
   so that "the full suite" means one command.
8. As a cell agent, I want the gates to pass on a workspace with zero feature packages, so that the
   first real package starts from green and any red is mine.
9. As a cell agent, I want Biome to lint and format TypeScript and JSON,
   so that there is one tool and one configuration (ADR-0014 §3).
10. As a cell agent, I want `.vue` files excluded from Biome, so that Phase 1's `packages/web` is
    not linted by an experimental parser (ADR-0014 §3).
11. As a cell agent, I want the Python v1 tree excluded from every v2 gate, so that v1's code never
    turns a v2 check red.
12. As a cell agent, I want Biome's `noImportCycles` on with `ignoreTypes: true`, so that a runtime
    cycle inside a package fails the gate while a type-only import does not.
13. As a cell agent, I want Biome's `noPrivateImports` on, so that a symbol marked `@package` is
    flagged when imported from outside its package, as a helpful default (ADR-0014 §2).
14. As a cell agent, I want the cross-package cycle check to name the cycle it found, package by
    package, so that I can fix it without reconstructing the graph by hand.
15. As a cell agent, I want the cross-package cycle check to report every cycle in one run, not just
    the first, so that a cycle hidden behind another one doesn't need a second CI round to surface.
16. As a cell agent, I want the cross-package check to fail loudly on a malformed or unreadable
    `package.json`, so that a broken manifest cannot make the graph look acyclic.
17. As a cell agent, I want the only way to keep a cycle to be a `biome-ignore` comment with a
    justification at the import site, so that the reason sits in the diff where review sees it
    (ADR-0014 §4). There is no baseline file.
18. As a reviewer, I want CI to run on every PR and on every direct push to `revival`, so that
    sequential work committed straight to the trunk is gated as well as parallel PRs.
19. As a reviewer, I want CI to install from the committed lockfile and fail if it would change, so
    that what CI verified is what is committed.
20. As a reviewer, I want the Bun version pinned in one place that CI and local runs both read, so
    that "green locally, red in CI" is never a version mismatch.
21. As a reviewer, I want CI to report lint, format, type, cycle and test results as separately named
    steps, so that I can see which gate failed without reading logs.
22. As Cal, I want the v1 GitHub workflows left untouched, so that v1's Docker publish and CodeQL
    scan keep working on `master` and do not fire on `revival`.
23. As Cal, I want agents denied `gh issue comment|close|edit|label` and `gh pr comment|merge`, so
    that no agent can write to a stranger's issue thread on the public repo.
24. As Cal, I want agents denied `git push --force` and any push to `master`, so that the two
    unrecoverable git mistakes can't happen during a wave.
25. As Cal, I want the routine commands (`bun install`, `bun test`, `bun run build`, `bun run check`
    and the `:check` variants, local `git` operations, read-only `gh`) allowed, so that a wave of
    three cells doesn't stall on permission prompts.
26. As a future agent, I want the scaffold's conventions documented where ADR-0014 §10 put them
    (one-liners in `AGENTS.md`, detail in `docs/build-process.md`), so that I read them in the
    right place and don't find them duplicated.
27. As a future agent, I want the `AGENTS.md` quality gate to stop being labelled "aspirational"
    once the scaffold lands, so that I treat it as binding.
28. As the song-dict cell, I want to create `packages/core` as an ordinary new package against this
    scaffold, so that I'm the first real tenant of the workspace without having to write a
    placeholder.
29. As the fuzzymatch-corpus cell, I want the v1 checkout still runnable in place, so that I can
    generate the golden corpus from v1 itself (ADR-0006).
30. As Cal, I want the scaffold to add no feature packages, so that the first package anyone reviews
    is real code and not a stub that later cells either fill or delete.

## Implementation Decisions

- **No feature packages.** The scaffold creates the workspace root and the cross-package cycle
  checker only. `packages/core` is created by the song-dict cell, and the other ADR-0001 packages by
  whichever cell first needs them. *Decided in this spec (Cal, 2026-10-15). Rejected: empty ADR-0001
  skeletons, which would be placeholders with nothing to check.*
- **The v1 tree is left untouched.** `ultrasonics/`, `app.py`, `requirements.txt`, the Dockerfile,
  `Makefile`, the service file and both v1 GitHub workflows stay where they are. The v2 gates scope
  themselves to v2 paths, so v1 needs no changes. v1 is removed in Phase 4. *Decided in this spec
  (Cal, 2026-10-15). Rejected: moving v1 to a subfolder now, which would churn paths the corpus and
  importer cells are about to read.* The root `.gitignore` is extended for Bun/Node artefacts; its
  v1 entries stay.
- **Workspace.** The root `package.json` is private, declares workspaces for `packages/*` and
  `packages/plugins/*`, and owns the scripts. The committed lockfile is Bun's.
- **Bun version.** Pinned in a single source that both local tooling and CI's Bun setup read. The
  spec doesn't fix the number: use the current stable release when the cell is built, and record it
  in the handoff.
- **TypeScript.** A root base configuration (`strict`, plus `noUncheckedIndexedAccess`) that
  packages extend. `exactOptionalPropertyTypes` is left off. It clashes with Zod-inferred optional
  fields, and the song-dict cell can turn it on if it proves its worth. A root
  configuration that extends it covers the root's own TypeScript (the cycle checker), so
  type-checking has inputs even with zero packages. `tsc --noEmit` only, because Bun runs the source.
- **Biome** owns lint and format for the whole v2 surface, `.vue` excluded and v1 paths excluded.
  `noImportCycles` (with `ignoreTypes: true`) and `noPrivateImports` are on. Otherwise use
  Biome's recommended rules and default formatter, apart from line width, which matches the repo's
  existing prose wrap of 100. Further rule choices are for later cells, made when there is code to
  judge them on.
- **Scripts** (ADR-0014 §8). `check` runs `biome check --write` then type-check (plus `vue-tsc`
  once `packages/web` exists, which isn't in this cell). `check:ci` is `lint:check` ·
  `format:check` · `type-check` · `cycle-check`, all read-only, failing rather than repairing.
  `test` runs `bun test` across the workspace. The intra-package cycle rule runs inside
  `lint:check`. `cycle-check` is the cross-package script.
- **The cross-package cycle checker** is the one module with behaviour. Its interface: given a
  workspace root, it expands the root's workspace globs, reads each member's manifest, and builds a
  graph whose edges are dependencies (runtime, dev, peer and optional) naming another workspace
  member. It returns either "acyclic" or a list of every elementary cycle, each one an ordered list
  of package names. The script wrapper prints each cycle as `a → b → a` and exits non-zero if there
  is any cycle or any unreadable or malformed manifest. Zero members is acyclic. It lives in the
  repo's root tooling, not in a package, because it checks packages and isn't one.
- **CI** is a new GitHub Actions workflow beside the v1 ones. It triggers on `pull_request` and on
  `push` to `revival`, sets up the pinned Bun, installs with a frozen lockfile, then runs each
  `check:ci` component and the tests as separately named steps. No caching or matrix: add them
  when there's code slow enough to need them.
- **Agent permissions.** `.claude/settings.json` holds exactly the allow and deny lists in ADR-0014
  §9 / `docs/build-process.md`. Deny takes precedence over allow, and the deny entries are written so
  that flag-reordered or option-prefixed variants are still denied wherever the settings syntax
  allows it.
- **Docs.** `AGENTS.md` § Quality gate drops "once code exists" and "aspirational". The handoff
  records the pinned Bun version. The roadmap's Phase 0 status line gains "scaffold landed". No new
  ADR is needed unless the build forces a choice that this spec and ADR-0014 don't cover.

## Testing Decisions

- **One automated seam: the cycle checker's entry point.** Point it at a workspace root and assert
  on the verdict and the named cycles. Tests treat it as a black box and never assert on graph
  internals or on which traversal found a cycle. *Seam confirmed with Cal, 2026-10-15.*
- **Fixtures** are small throwaway workspaces under the root tooling's `test/fixtures/` (ADR-0014
  §5): zero packages; a linear chain; a two-package cycle; a three-package cycle; two disjoint
  cycles (both must be reported); a cycle only through `devDependencies`; a dependency on an
  external package of similar name (no edge); a malformed manifest (must fail, not pass).
- **The config gates are proved by `/verify`, not by tests.** For each of lint, format, type,
  intra-package cycle and cross-package cycle, plant one violation in a scratch package, run
  `bun run check:ci`, observe the right step fail, then remove the violation and observe green. Also
  confirm that a type-only intra-package cycle passes and that a justified `biome-ignore` suppresses
  a real one. Record the observations in the handoff. *Rejected: an automated test that runs
  `check:ci` against fixture violations. It's slow, and it re-tests Biome and tsc rather than
  anything we wrote.*
- **Permissions are verified by inspection** against ADR-0014 §9, because a denied command can't
  be exercised safely.
- **Prior art:** none in v2. This is the first code. The tests set the house pattern of `bun:test`,
  colocated `*.test.ts` and fixture data apart.

## Acceptance criteria

- [ ] `bun install` on a clean clone succeeds and leaves the lockfile unchanged.
- [ ] `bun run check:ci` and `bun run test` pass on the scaffold as landed, with zero feature
      packages.
- [ ] Each of the five gates fails `check:ci` on a planted violation and passes once it is removed,
      as observed in `/verify`.
- [ ] A type-only import cycle inside a package passes. A runtime one fails unless it has a justified
      `biome-ignore`.
- [ ] The cycle checker reports every cycle in each fixture, named package by package, and fails on
      a malformed manifest.
- [ ] CI runs on a PR and on a direct push to `revival`, with each gate as a named step, and is
      green.
- [ ] A new directory under `packages/` or `packages/plugins/` with a `package.json` is picked up by
      install, type-check and the cycle checker without editing root configuration.
- [ ] Nothing under the v1 tree is modified, and v1's workflows still trigger only on `master`.
- [ ] `.claude/settings.json` matches ADR-0014 §9's allow and deny lists exactly.
- [ ] `AGENTS.md`'s quality gate is no longer labelled aspirational. The roadmap's Phase 0 status
      line records the scaffold. A handoff and a session log are written.

## Out of Scope

- Any feature package, including `packages/core` and the song dict in Zod (the next cell).
- The fuzzymatch golden corpus and getting v1 running to produce it.
- Linting `.vue` and setting up `vue-tsc` (Phase 1, once `packages/web` has files).
- A v2 Dockerfile, image publishing or release workflow (Phase 4).
- Removing, moving or modernising the v1 tree or its workflows (Phase 4).
- CI caching, matrices, coverage thresholds or required-status branch protection.
- Loosening the permission allowlist (expected only if `revival` becomes the trunk).

## Further Notes

- Under `docs/build-process.md` this is an `/implement` cell (scaffolding and wiring), except for
  the cycle checker, which is built with `/tdd` against the fixtures above.
- It touches no checkpoint gate in `AGENTS.md` (auth, SDK contract, schema, tenancy), so it needs no
  `/grill-with-docs` freeze beyond this spec. It's sequential work and lands directly on `revival`.
- If Biome's `noImportCycles` or `noPrivateImports` turns out to be missing, renamed or behaving
  differently in the current Biome release from what ADR-0014 assumed, that's a checkpoint: record
  it and ask, don't quietly substitute a different tool (ADR-0014's fallback is ESLint and
  Prettier, a Cal decision).
