# Spec: the playlist merger

Draft for grilling. Phase 2 (plugin parity). Builds on [Spec: the matcher, rebuilt on record-linkage practice](https://github.com/XDGFX/ultrasonics/issues/132), whose `match` this plugin calls, and on the runner (#110), which concatenates the playlists of every input. Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md). This spec has none.

## Problem Statement

An applet with two inputs hands its outputs the playlists of both, one after the other (`packages/core/src/runner.ts`). When both inputs hold a playlist of the same name, say "Gym" on Spotify and "Gym" in Plex, the outputs receive two playlists called "Gym". The Plex output skips an ambiguous target only on its own side (#114), so in `update` mode the second "Gym" overwrites the first. v1's answer was the playlist merger, and v1's docs called it "required whenever an applet has more than one input" (`legacy-architecture.md`).

v1's merger had faults of its own:

- It compared names exactly, so "gym" and "Gym" stayed apart.
- It put the second playlist's songs first and appended the first playlist's new songs after them, then moved the merged playlist to the end of the list.
- It removed the originals with `songs_dict.remove(dict)`, which compares whole dicts, so a playlist carrying any key the merger hadn't rebuilt (a description, say) raised `ValueError` and killed the run.
- It ran `fuzzymatch.duplicate`, which carries a field score from one candidate into the next (ADR-0022, Context), against a hand-set ratio of 90.

## Solution

A new plugin, `playlist-merger`, in its own package, with a `modifiers` component in `playlists` mode. It groups the incoming playlists by name, and replaces each group with one playlist: the first playlist's songs, then each later playlist's songs that the matcher doesn't find among the songs before it. It has no settings, no auth and no threshold.

## User Stories

1. As a user with two inputs that share playlist names, I want same-named playlists combined into one, so that each output writes each playlist once.
2. As a user, I want names compared after trimming and without regard to case, so that "gym" and "Gym " merge.
3. As a user, I want the first input's songs first, in their order, then the songs only the later inputs had, in theirs.
4. As a user, I want a song both inputs hold kept once, as the first input had it, so that the merged playlist doesn't repeat it.
5. As a user, I want "the same song" decided by the same matcher the outputs use, so that merging and writing agree.
6. As a user, I want a playlist's own deliberate repeats kept, so that the merger removes only what a second input added.
7. As a user, I want the merged playlist to carry every service id the group held, so that each output still finds its own playlist.
8. As a user, I want the merged playlist to sit where the group's first playlist sat, so that the order of my playlists doesn't change.
9. As a user, I want playlists with no namesake passed through untouched.
10. As a user, I want the log to say which names were merged, from how many playlists, and how many songs were dropped as duplicates.
11. As a user, I want there to be no ratio to set, so that a blank field can't crash a run (must-still-work #3).
12. As a user with two 10,000-song playlists, I want the merge to finish in seconds, not minutes.
13. As a v1 user, I want my merger applets imported without asking me anything.
14. As a maintainer, I want the plugin to pass `runConformance`.

## Implementation Decisions

### Package and handshake

- `packages/plugins/playlist-merger/` (ADR-0014 §6), depending on `@ultrasonics/plugin-sdk` and `@ultrasonics/matcher`. `officialPlugins` gains `playlist-merger` (ADR-0012 §4).
- `mode: ["playlists"]`, `modifiers` the only component. No `auth`, no `persistentSettings`, no `test()` (ADR-0012 §5 makes it optional).
- `instanceSettings: { modifiers: z.object({}) }`. ADR-0012 §8's key parity needs the key, and ADR-0019 §6 renders an empty object as no form. Its object-level `description` explains what the merger does.

### Merging (`run.modifiers`)

1. **Group** `ctx.songs.playlists` by name, trimmed and compared case-insensitively with `toLocaleLowerCase("und")`. Groups of one pass through as they are.
2. **The merged playlist** for a group:
   - `name`: the first playlist's name, as it was.
   - `description`: the first non-absent description in the group.
   - `id`: every key from every playlist in the group. Where two playlists hold different values under one key (two Spotify playlists both called "Gym"), the first wins and the run logs a `warn` naming the key. Outputs look playlists up by id, so this decides which of the two gets written.
   - `songs`: the first playlist's songs, unchanged and in order. Then, for each later playlist in input order, each of its songs in order, unless `match(song, earlier).matched` is true for a song from an **earlier** playlist in the group. Songs a later playlist repeats within itself are compared only against earlier playlists, so its own repeats survive (story 6).
   - It takes the position of the group's first playlist. The group's other playlists are removed. Nothing is located by dict equality.
3. **Matching** is `match` from `@ultrasonics/matcher`, P1 as #132 built it: hard keys first, then title, artist and length. There is no threshold setting (#104, decision 7), and no tie-break, because the merger only asks whether a match exists.
4. **Cost.** A naive merge of two 10,000-song playlists is 10⁸ calls to `match`. The merger avoids most of them in two ways, neither of which can drop a pair `match` would accept:
   - **Hard keys first.** Earlier songs are indexed by every `id` entry, `location` and `isrc`. An `id` or `location` hit is a match, as `judge` rules before any veto (`judgement.ts`). An `isrc` hit still goes through `match`, because the matcher applies its length veto to a shared ISRC ("some ISRCs are wrong").
   - **The length veto.** Short of an `id` or `location` hit, `match` never accepts two songs whose lengths differ by more than `lengthVetoMs` (30 seconds, `agreement.ts`). Earlier songs with a `durationMs` are sorted by it, and a later song with a length is compared only with those inside its window, plus every earlier song without a length.

   If the matcher's veto rule changes, the window changes with it: the merger imports the constant instead of copying it. A matcher export is the one change this spec makes outside its own package, and it is additive.
5. **Logging:** one `info` line per merged group: the name, how many playlists, songs in, songs dropped as duplicates.

### v1 import mapping (ADR-0017 §5)

| v1 `playlist merger` | v2 `playlist-merger` |
|---|---|
| per-applet `fuzzy_ratio` | Dropped. v2 has no threshold (#104, decision 7). |
| global `fuzzy_ratio` (`plugins` row) | Dropped. |
| the component itself | `{}` |

The import report says once, not per applet, that match thresholds no longer exist and matching has changed (ADR-0022 §5). The mapping is tested against a v1 fixture holding a merger with a blank ratio, one with `"85"`, and one with v1's placeholder text `"Currently: 90 👾"`, which v1's builder wrote into the field.

### v1 behaviour dropped

- Exact, case-sensitive name comparison.
- Second-input-first song order, and moving the merged playlist to the end.
- `songs_dict.remove(dict)`, which crashed on any playlist with an extra key.
- The user-set ratio, and the three-level `instance → global → 90` fallback behind it (`legacy-architecture.md`).

## Open questions

1. **Should the runner merge same-named playlists itself, and the plugin go?** Every multi-input applet needs the merge, and v1 users forgot to add it.
   - **Recommendation:** keep the plugin, for parity. The roadmap lists it, the importer can map it one to one, and an applet whose inputs deliberately emit two same-named playlists (a songs-mode output reading both, for instance) keeps that choice. Revisit if users trip over it.
   - Alternative: the runner merges by default and the plugin is dropped from the roadmap. That changes what every multi-input applet does, and ADR-0011's run semantics would need an amendment.
2. **Case-insensitive names.** v1 compared exactly.
   - **Recommendation:** trimmed and case-insensitive, as above. Services disagree on case often (Spotify keeps it, a filename may not), and two playlists that differ only in case are almost always one playlist.
   - Alternative: exact comparison, as v1.
3. **A conflicting id under one key.** Two Spotify playlists both called "Gym" can't both survive in one `id` map.
   - **Recommendation:** the first wins, with a warning.
   - Alternative: drop the key, so the output falls back to its name lookup. That's quieter and can create a third playlist.

## Testing Decisions

- Through the `modifiers` handler and `runConformance` only, with the real matcher. Fixtures carry obvious duplicates (shared ISRC, shared id, identical title/artist/length) and obvious non-duplicates, so the tests don't depend on the matcher's tuning.
- **Conformance:** settings fixtures (valid: `{}`; invalid: none needed beyond an unknown key being stripped), the SDK's default song dict. Strict song-dict validation passes.
- **Cases:** no namesakes pass through unchanged and in order; two and three same-named playlists merge in input order; case and whitespace differences merge; a duplicate by ISRC, by id, by `location`, and by title/artist/length is dropped; a remix of a song in the first playlist is kept; a later playlist's own repeats are kept; ids union, with a conflict warning and the first value kept; description from the first that has one; a playlist with an extra description key no longer crashes; the merged playlist sits at the first playlist's position.
- **Cost:** two generated 10,000-song playlists merge in under 10 seconds on CI, and a test pins that the length window never skips a pair `match` accepts on a generated set.
- **The import mapping** against its v1 fixture.

## Out of Scope

- Deduplicating within one playlist. v1 didn't, and it would remove deliberate repeats.
- Merging playlists whose names differ ("Gym" and "Gym 2024").
- A user threshold, or any match setting.

## Further Notes

- **No change to the plugin SDK contract, the auth layer or the schema.** The one change outside the package is exporting `lengthVetoMs` from `@ultrasonics/matcher`.
- `legacy-architecture.md` lists the merger's complexity as trivial to moderate. The cost bound is what makes it moderate.

## Planned tickets and acceptance criteria

**One ticket: "Playlist merger"**, blocked by nothing open (#132's matcher is delivered as #148). The mapping half waits for the importer's base ticket, as every Phase 2 port's does.

- [ ] `playlist-merger` is registered, passes `runConformance`, and has no auth, no persistent settings and no form.
- [ ] Same-named playlists (trimmed, case-insensitive) become one playlist at the first one's position; others pass through unchanged.
- [ ] The first playlist's songs come first and unchanged; later songs follow in input order unless they match a song from an earlier playlist in the group.
- [ ] A later playlist's own repeats are kept.
- [ ] Ids are unioned; a conflict keeps the first and logs a warning.
- [ ] Two 10,000-song playlists merge in under 10 seconds on CI, and the blocking never skips a pair `match` accepts.
- [ ] One `info` line per merged group with counts.
- [ ] The v1 mapping drops both ratios, the report notes it once, and it is tested against a v1 fixture (ADR-0017 §5).
- [ ] `bun run test` and `bun run check` are green for the new package, the matcher and the importer.
