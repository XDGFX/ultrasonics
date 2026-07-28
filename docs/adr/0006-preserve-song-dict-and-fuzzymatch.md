# ADR-0006 — Preserve the song dict and fuzzymatch verbatim

**Status:** Accepted
**Date:** 2026-07-28

## Context

Two pieces of v1 are the reason it worked and earned its audience: the **song dict** interchange
format and the **fuzzymatch** weighted matching engine. They are small, battle-tested against real
messy metadata, and independent of the language and framework rot around them. A rewrite is a
temptation to "improve" both; doing so would discard years of tuning encoded in the weights and
the feat./remix-cleaning regexes, and would make it impossible to tell a port bug from a
behaviour change.

## Decision

**Port the song dict and the fuzzymatch algorithm unchanged.**

- The song dict keeps its exact shape (`CONTEXT.md`); it becomes a Zod schema, otherwise
  identical. It remains the interchange format between all plugins.
- fuzzymatch's hard-match keys (`location`, then `isrc`/`id`), field weights (title / artist /
  album / date), the fuzzy ratio choices per field, and the regex cutoffs for cleaning
  `feat.`/`remix`/`prod.` noise are reproduced exactly. See `docs/reference/legacy-architecture.md`
  for the authoritative weights and regexes.
- Correctness is pinned by **golden tests**: inputs run through the original Python produce
  expected outputs the TS port must reproduce. These are generated once from v1 and committed.

Improvements to matching are not forbidden — but they arrive as a *new* matcher strategy behind
the seam (`"fuzzy"` | `"llm"`, `CONTEXT.md`), leaving the deterministic default untouched and
regression-tested.

## Consequences

- fuzzymatch is the one piece with a hard equivalence bar; a plugin port is "done" only when its
  matching reproduces v1 on the golden set.
- The golden-test corpus must be generated from v1 early (roadmap Phase 1), which means keeping a
  runnable v1 checkout around long enough to produce it.
- Any future matching change is measured against this baseline rather than replacing it silently.
