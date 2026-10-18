# 03 — `toFileUri` and `fromFileUri`

**Status:** ready-for-agent

**Spec:** `../spec.md` · **Blocked by:** 01 · **Blocks:** 04 · **Build:** `/implement`

## What to build

Write `file-uri.ts`, exported from the package root, as specified in the spec's Implementation
Decisions (The helpers). It must handle Windows paths the same way whatever platform it runs on.
First check whether Bun's `url` module can be made to use Windows semantics on Linux. If it can't,
write the conversion directly.

## Acceptance criteria

- [ ] POSIX, Windows-drive (`C:\…`) and UNC (`\\server\share\…`) paths round-trip on the Ubuntu CI
      runner, including spaces, `#`, `%` and non-ASCII names.
- [ ] Relative paths and non-`file:` URIs give `undefined`. Neither function throws.
- [ ] Every `toFileUri` output parses under `Song`'s `location` rule.
- [ ] `bun run test` and `bun run check:ci` pass.

## Comments
