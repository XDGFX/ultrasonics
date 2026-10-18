# 02 — `normaliseIsrc` and `normaliseDate`

**Status:** ready-for-agent

**Spec:** `../spec.md` · **Blocked by:** 01 · **Blocks:** 04 · **Build:** `/implement`

## What to build

Write `isrc.ts` and `release-date.ts`, exported from the package root, as specified in the spec's
Implementation Decisions (The helpers). Each helper returns a value that passes the schema's rule
for its field, or `undefined`. Neither throws.

## Acceptance criteria

- [ ] Each of these normalises to its schema-valid form: lower-case ISRCs, hyphenated ISRCs, ISRCs
      with spaces, `Date` objects, year numbers, ISO date-times, and each partial ISO form.
- [ ] Impossible dates (`2021-02-30`), out-of-range years and malformed ISRCs give `undefined`.
- [ ] Every output parses under `Song`'s `isrc` and `date` rules (tested by parsing, not by
      repeating the regex).
- [ ] `bun run test` and `bun run check:ci` pass.

## Comments
