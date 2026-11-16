# ADR-0032 — The matcher offers a match index

**Status:** Proposed
**Date:** 2026-11-16
**Refines:** ADR-0029 (which limited the matcher's exports to `match`, `bestMatch` and their result types)
**Ticket:** [Matcher: candidate blocking so large merges are fast](https://github.com/XDGFX/ultrasonics/issues/230)

## Context

The playlist merger asks whether a song matches any of thousands of earlier ones. Calling `match`
on every pair inside the 30 s length veto took 37–186 s for two 10,000-song playlists. A faster
search has to know which pairs `match` can never accept, and only the matcher knows that: it
depends on the fitted weights, the threshold and how each similarity is computed. A plugin that
worked it out for itself would go stale at the next refit.

## Decision

**`@ultrasonics/matcher` exports `MatchIndex`**: `add(songs)`, then `matchesOf(song)` for every
indexed song `match(song, it)` accepts, in the order added, or `hasMatch(song)` for whether there
is one. It finds exactly what asking `match` of every pair finds. A property test holds it to
that, on generated songs and on the CC0 tier.

It uses record-linkage blocking that can't lose a match:

- **Hard keys** (ids, `location`, ISRC) are looked up by key.
- **A length window**, `fitted.lengthWindowMs`: the widest gap at which the best title and artist
  levels can still reach `matchThreshold`. `bun run fit-weights` derives it with the weights, so a
  refit can't leave it unsound. It is 3 s today.
- **A bound on the weight.** Each remaining candidate's title and artist similarity is bounded
  from above by the bag distance, which is never more than the edit distance. A pair whose bounded
  weight falls short of the threshold is skipped. Otherwise `match` decides.

`match` and `bestMatch` are unchanged. `lengthVetoMs` stays exported: tests outside the matcher
build pairs either side of the veto.

## Considered options

- **An index of normalised title words.** Rejected: unsound. "Hello" and "Hallo" by the same
  artist at the same length match (title 0.8), and share no word. No q-gram longer than one
  letter is guaranteed to be shared at the 0.5 title floor, so the letter bag is the strongest
  sound key, and it works as a bound, not an index.
- **Exporting the window and bounds as constants for the merger to use.** Rejected: every caller
  would copy the matcher's similarity rules, as `EarlierSongs` copied the veto.
