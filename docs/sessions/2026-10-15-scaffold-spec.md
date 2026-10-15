# 2026-10-15 — Phase 0 scaffold spec

**Status:** done

/wayfinder confirmed that the Phase 0 contracts map has no tickets left to work. /to-spec then wrote
the first spec.

## Done

**[Scaffold spec](../specs/scaffold/spec.md) written, `ready-for-agent`.** It is drawn from the
roadmap's Phase 0 scaffold brief and ADR-0014. Cal settled three things the docs left open:

- One automated test seam, the cross-package cycle checker. Every config gate is proved by a
  planted violation under `/verify`.
- No feature packages. The song-dict cell creates `packages/core`.
- The v1 Python tree and its workflows stay untouched until Phase 4.

## Next

Build the scaffold cell against the spec (`/implement`, with `/tdd` for the cycle checker). After
that, `/grill-with-docs` on the song dict in Zod and the fuzzymatch golden corpus. Cal still needs to
file the Spotify extended-quota and Apple Developer applications, if not already done.
