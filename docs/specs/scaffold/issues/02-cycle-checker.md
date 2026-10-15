# 02 — Cross-package cycle checker

**Status:** ready-for-agent

**Spec:** `../spec.md` · **Blocked by:** 01 · **Blocks:** 05 · **Build:** `/tdd`

## What to build

The one module with behaviour: the cross-package cycle checker and its `cycle-check` script
wrapper, wired into `check:ci`. Interface, output format and placement are in the spec's
Implementation Decisions ("The cross-package cycle checker"); the seam and the fixture list are in
Testing Decisions. Fixtures live under the root tooling's `test/fixtures/`.

## Acceptance criteria

- [ ] Each spec fixture passes as a black-box test of the entry point: zero packages; linear chain;
      two-package cycle; three-package cycle; two disjoint cycles (both reported); cycle only via
      `devDependencies`; similarly named external dependency (no edge); malformed manifest (fails).
- [ ] The wrapper prints each cycle as `a → b → a` and exits non-zero on any cycle or bad manifest.
- [ ] `bun run cycle-check` passes on the real repo, and `check:ci` runs it.
- [ ] Fixture workspaces are not picked up by the real workspace, Biome's cycle rule or tsc in a
      way that turns the gate red.
