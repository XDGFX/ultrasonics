# Spec: spotify-mixer

Draft for grilling. Phase 2 (plugin parity). Points marked **⚑ checkpoint** touch the auth layer, the plugin SDK contract, the database schema or multi-tenancy (AGENTS.md).

**Verdict: spotify-mixer can't be ported.** Every version of it rests on Spotify's recommendations endpoint, which Spotify closed to new apps on 27 November 2024. Every v2 self-hoster runs a new app. This draft recommends dropping the plugin from Phase 2's parity gate, the way `system-command` was dropped, and says what the import does with v1 applets that used it.

## Problem Statement

v1's `spotify mixer` is a modifier. For each playlist it receives, it:

1. renames the playlist, from a comma-separated `playlist_titles` setting, position by position (`*` keeps the name), and clears its `id` when renamed;
2. searches Spotify for each song, keeping those above the fuzzy ratio;
3. takes at most 50 of the found track ids at random, in seeds of five;
4. calls `GET /recommendations?seed_tracks=…&limit=100` once per seed;
5. promotes tracks that more than one seed returned, then fills up to `playlist_length` (default 50) at random from the rest;
6. replaces the playlist's songs with the result.

Step 4 is the plugin. Spotify's [Web API changes of 27 November 2024](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) removed Recommendations, Related Artists, Audio Features, Audio Analysis and featured and category playlists for apps without extended quota made after that date. Extended quota is now for organisations with 250,000 monthly users ([Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)), which no self-hoster is (#136, #135). A v2 mixer would answer 404 or 403 on every call it exists to make.

Nothing else on Spotify's development-mode API replaces it. Related artists and audio features went in the same change. The February 2026 changes removed artist top tracks and the browse endpoints, cut search to 10 results per call, and removed the batch endpoints ([February 2026 changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)).

## Solution

**Drop `spotify-mixer` from Phase 2.** Concretely:

- `roadmap.md`: remove `spotify-mixer` from Phase 2's list and add it under "Dropped" with the reason and the date. Phase 2's exit gate ("feature parity with v1 *minus the dropped plugins above*") then excludes it with no further edit.
- `legacy-architecture.md`: the parity matrix marks it dropped, as it does `system command`.
- The importer treats a v1 applet that uses `spotify mixer` as using an unknown plugin: the applet is skipped and reported with its v1 config (ADR-0017 §4). The report's line for it says why: "Spotify no longer offers the recommendations this plugin used".
- No package, no registry entry, no `service` change.

## User Stories

1. As a v1 user with a mixer applet, I want the import report to tell me the applet wasn't brought across and why, so that I'm not left wondering where it went.
2. As a v1 user, I want my other applets imported as usual.
3. As a maintainer, I want the parity gate to say plainly that the mixer is out, so that Phase 2 isn't held open by a plugin that can't work.
4. As Cal, I want the decision recorded where the next reader looks (the roadmap's "Dropped" list), so that it isn't re-litigated per port.

## Implementation Decisions

- **Dropped, not deferred.** A plugin that calls an endpoint new apps can't reach would fail every run. Shipping it disabled or hidden adds code that nobody can run.
- **The import:** unknown-plugin handling (ADR-0017 §4) already does the right thing. The importer's mapping table names `spotify mixer` explicitly, so the report can give the reason instead of the generic "unknown plugin" line. Its persistent settings (`fuzzy_ratio`) and the shared Spotify `auth` blob are ignored; the Spotify grant is reported once, by the Spotify mapping (spec-spotify-output.md).
- **The shared grant:** nothing changes. ADR-0013 §2's example of two plugins sharing `service: "spotify"` stays true in principle, and spotify-output's spec no longer has to keep its scopes in step with a second plugin (the server refuses to boot when two plugins declare one service differently, `packages/server/src/catalogue.ts`).
- **v1 behaviour that goes with it:** random sampling of seeds and fill, so two runs of one applet gave different playlists; clearing a renamed playlist's ids, which made the next output create a new playlist every run.

## Open questions

1. **Drop it, or replace it?**
   - **Recommendation:** drop it from Phase 2, as above. Parity means porting what v1 did, and what v1 did is gone.
   - Alternative A: a service-agnostic "similar songs" modifier in Phase 3, built on Last.fm's `track.getSimilar` with the Last.fm grant from spec-lastfm.md. It would emit title and artist only, and each output would match them as it matches anything else. That's a new feature with its own spec, not this one. If Cal wants it, file it as a Phase 3 idea rather than a parity item.
   - Alternative B: port it against recommendations anyway, for the few self-hosters with an app made before 27 November 2024. v2 can't tell such an app from a new one until a call fails, and the cohort shrinks as apps are rotated. Rejected.
2. **Does dropping it need an ADR?** `system-command`'s drop was recorded in the roadmap, not an ADR.
   - **Recommendation:** the roadmap's "Dropped" entry is enough. Nothing about the design changes; an external API went away.
   - Alternative: a short ADR, if Cal treats any narrowing of the parity gate as a design decision.

## Testing Decisions

- The importer's fixture gains a v1 applet with `spotify mixer` as a modifier. The test asserts the applet is skipped, its v1 config is in the report, and the report gives the recommendations reason. The other applets in the fixture import.

## Out of Scope

- Any recommendation or radio feature.
- Playlist renaming as a modifier. v1 bundled it into the mixer; nobody has asked for it alone.

## Further Notes

- Sources: [Introducing some changes to our Web API](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) (27 November 2024); [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes); [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide). #136 cites the same pages, checked 16 November 2026.
- `GLOSSARY.md`'s **Service** entry gives spotify-mixer as its example of a shared grant. Once the drop lands, the example should name the Spotify input and output, which share the grant through one plugin, or stay as a hypothetical. That's a one-line glossary edit in the same ticket.

## Planned tickets and acceptance criteria

**One ticket: "Drop spotify-mixer from Phase 2"**, docs plus one importer case. Blocked by the importer's base ticket for the importer half only.

- [ ] `roadmap.md` lists `spotify-mixer` under "Dropped" with the reason and date, and no longer under Phase 2's ports.
- [ ] `legacy-architecture.md`'s parity matrix marks it dropped.
- [ ] `GLOSSARY.md`'s **Service** example no longer depends on spotify-mixer existing.
- [ ] The importer skips a v1 applet using `spotify mixer`, reports it with its config and the reason, and imports the rest; tested against a v1 fixture.
- [ ] `bun run test` and `bun run check` are green for the importer.
