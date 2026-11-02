# ADR-0029 — The matcher and its match dataset are their own package

**Status:** Proposed
**Date:** 2026-11-02
**Refines:** ADR-0001 (which put the matcher and its match dataset in `packages/core`)
**Spec:** [Spec: the matcher and the match dataset](https://github.com/XDGFX/ultrasonics/issues/117)

## Context

ADR-0001 put "the matcher and its match dataset" in `packages/core`. Core now holds the runner,
which depends on `@ultrasonics/db`. Plugins call the matcher, Plex first. A plugin that imported
core would depend on the runner and its database types, which ADR-0014 §6's dependency isolation
and ADR-0010's worker-shaped plugin boundary both argue against. A subpath export of core would
still be a dependency on the whole package.

## Decision

**The matcher is `packages/matcher`, published as `@ultrasonics/matcher`.** It depends only on
`@ultrasonics/plugin-sdk`, for `Song`, and only plugins depend on it, so no cycle is possible. Its
`exports` offer `match`, `bestMatch` and their result types, and nothing else. The match dataset,
its schema, the harness, the CC0 builder and the service-tier collector are internals and package
scripts.

The match dataset lives in the package's `test/fixtures/`, as ADR-0014 §5 places test data, so it
moves with the matcher.

## Considered options

- **The matcher in `packages/core`**, as ADR-0001 sketched. Rejected: every plugin that matches
  songs would depend on the runner and the database.
- **A subpath export of core.** Rejected: a subpath narrows what is imported, not what the plugin
  depends on.
- **The matcher in `packages/plugin-sdk`.** Rejected: it would put the dataset, the harness and
  any future string-similarity dependency into the contract every plugin compiles against.
