# 2026-10-15 — Zod → settings-form generation (map ticket 016)

/wayfinder, working the map. One ticket resolved.

## Done

**Ticket 016 resolved.** Cal agreed across three grilling rounds. The decision is
[ADR-0019](../adr/0019-settings-forms-rendered-from-json-schema.md), which is Proposed.

- Zod 4 is pinned. The server serves `toJSONSchema` output, and the web package renders it without
  importing plugin code.
- A typed `.meta()` helper (`title`, `description`, `placeholder`, `warning`, and `secret` for auth
  only) keeps v1's prose and data-loss warnings in the schema.
- The Phase 1 renderable subset is enforced as a fourth `runConformance` invariant.
- The server is the only validator, issues map onto fields by path, and an empty input means the
  key is absent.
- One renderer covers persistent settings, instance settings and auth `fields`.
  `persistentSettings` becomes optional (`plugin-sdk-v2.md` amended).
- Radio versus select for a discriminator is left to the Phase 1 spec's Spotify-form prototype.
- In the map's fog, the auth-wizard renderer item is cleared and settings migration between plugin
  versions is added.

## Next

Cal to accept ADR-0019. Frontier: 017 ⛔, the last ticket on the map.
