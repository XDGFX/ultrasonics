# ADR-0022 — Design the song dict and the matcher fresh

**Status:** Accepted
**Date:** 2026-10-18
**Supersedes:** ADR-0006

## Context

ADR-0006 kept v1's song dict and fuzzymatch unchanged. Its case was that both were
"battle-tested" and that the weights and regexes held "years of tuning". That was never true: the
weights were set once, by hand, and never tested. v1 also has bugs that change its output. For
example, `duplicate()` carries a field score from one candidate into the next. And v1 has no
schema, so a port that kept the song dict "exactly" would still have to decide about nulls, empty
fields and date formats.

ADR-0006 also argued that the golden corpus could tell a port bug from a behaviour change. That
only matters when the goal is to copy v1. A corpus measures how closely v2 agrees with v1, not
whether v2 matches correctly. Nobody has shown that v1 matches correctly.

Two things make now the right time. No plugin depends on the song dict yet. And v1 has about 50
users, who can accept a release note that says matching has changed.

## Decision

**v2 designs both pieces from scratch. v1 is reference material, not a specification.**

1. **The song dict** is designed for v2, with v1's shape (`docs/reference/legacy-architecture.md`)
   as the starting point. It stays the only interchange format between plugins, as a Zod schema.
   After it is frozen, changing it is an ADR-level decision, as before.
2. **The matcher** is designed for v2. v1's weights, regexes and hard keys are inputs to the
   design, not targets for it. No v1 behaviour has to be reproduced, bugs included.
3. **The matcher is measured against a labelled match dataset, not against v1.** The dataset
   holds song pairs whose answer is known:
   - *same recording*: songs from two services that share an ISRC. The test hides the ISRC from
     the matcher, so it has to match on the other metadata.
   - *different recordings that look alike*: remix versus original, live versus studio, covers,
     and different songs with the same title.

   Its size, sources, labelling method and the accuracy target are left to the matcher's spec.
4. **No runnable v1 checkout is needed.** The v1 code stays in the repo for reading.
5. **Behaviour changes for v1 users are accepted.** A v1 threshold such as the merger's 90 does not
   have to mean the same thing in v2. The migration guide says so.

The `"fuzzy" | "llm"` matcher-strategy seam came from ADR-0006. This ADR neither keeps nor drops
it. The matcher's spec decides.

## Consequences

- The song dict needs a design spec before it is built, not a port spec. It is still the first
  core work of Phase 0.
- The match dataset moves to Phase 1, beside the matcher it measures. Phase 0 no longer has to
  produce anything from v1.
- Phase 1's exit gate changes from "golden tests reproduce v1 output" to "the matcher meets its
  accuracy target on the match dataset".
- The dataset contains metadata copied from streaming services. Their terms must allow it to be
  committed to a public repo, or the dataset is stored elsewhere.
- fuzzywuzzy and python-Levenshtein have no TypeScript equivalent to match, so the matcher can
  use any string-similarity method.
