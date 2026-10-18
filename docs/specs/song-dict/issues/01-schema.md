# 01 — The plugin-sdk package and the song dict schema

**Status:** ready-for-agent

**Spec:** `../spec.md` · **Blocked by:** none · **Blocks:** 02, 03, 04 · **Build:** `/implement`

## What to build

Create `packages/plugin-sdk` (`@ultrasonics/plugin-sdk`), with `zod` 4.6.7 as a dependency and
`"."` as its only export. Write `song-dict.ts`, which holds three schemas: `SongDict`, `Playlist`
and `Song`. Each schema has a lenient form and a strict form, and each exports its input and output
types. Every rule is in the spec's Implementation Decisions (The schema). Fixtures go in
`test/fixtures/`.

## Acceptance criteria

- [ ] The spec's schema criteria pass:
  - blanks are absent;
  - title and artists follow their rules;
  - bad formats fail at their own paths;
  - unknown keys are stripped (lenient) or rejected (strict);
  - `version` and `id` defaults apply.
- [ ] The type-level test shows `SongDictInput` admits `null` and `""` in optional fields and
      `SongDict` excludes them. No shipped type is `any` or `unknown`.
- [ ] `bun run test` and `bun run check:ci` pass.

## Comments
