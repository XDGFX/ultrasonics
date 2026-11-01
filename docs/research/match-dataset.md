# Research: where the match dataset comes from

**Date:** 2026-11-01
**Answers:** [#101](https://github.com/XDGFX/ultrasonics/issues/101), a child of the Phase 1 specs map (#100)
**Informs:** the matcher's method and accuracy target (#104) and the "Matcher and match dataset" spec
**Builds on:** ADR-0022 §3 (a labelled match dataset, not v1, measures the matcher), ADR-0023
(the song dict's shape), [`song-dict.md`](song-dict.md) Q7 (ISRC)

Every external claim cites the source that owns it. I read terms pages as they stood on the date
above. Where I could not reach a source, I say so. None of this is legal advice. It is a reading of
each service's own words.

## 1. Summary

- **Only open data can be committed.** MusicBrainz core data, Wikidata and the Discogs dumps are
  CC0. The developer terms of Spotify, Apple, Tidal and YouTube forbid keeping a compilation of their
  metadata or passing it on. Deezer's terms allow nothing beyond private use. ytmusicapi has no
  terms that grant anything.
- **So the dataset has two tiers:**
  1. A **committed CC0 tier** in `test/fixtures/`, built from MusicBrainz plus hand-written cases.
     It runs in CI.
  2. A **local service tier**, fetched with the developer's own API keys from a committed manifest
     of ISRCs. It lives in a git-ignored cache and is never published. The exit-gate accuracy figure
     comes from this tier, because only it holds real service formatting.
- **MusicBrainz is the best source of both positives and traps.** One ISRC lookup returns the
  recording, its URL links to Spotify, Deezer, Apple and Tidal, and its work. The work's other
  recordings carry `cover` and `live` attributes, and recording-to-recording relationships mark
  edits and remixes.
- **Remasters are the hole.** MusicBrainz merges remasters into one recording. Services sometimes
  give a remaster a new ISRC. Whether a remaster counts as a match is a product decision for #104,
  and the labels need a third class for it.
- **Size:** about 1,000 positive pairs and 100 or more pairs per trap category, about 500 traps in
  all. That puts a 95% interval of roughly ±1.4 percentage points on the overall figure, and
  bounds each trap category's error rate to within a few points.

## 2. What may be committed: the terms, source by source

| Source | Verdict | Governing clause |
| --- | --- | --- |
| Spotify | **No** | Developer Terms IV.3.1.1: "may not store, aggregate or create compilations or databases of Spotify Content… other than as strictly necessary to operate your SDA". IV.2.5: "do not transfer Spotify Content to third parties… even if a user consents". |
| Apple Music | **No** | Developer Program Licence Agreement 3.3.6(D): do not call the MusicKit APIs "for purposes unrelated to facilitating access to Your end users' Apple Music subscriptions". |
| Deezer | **No** | API terms Art. IV: "use of the Content is limited to a strictly private use within a family scope". Art. IX: any other use needs Deezer's prior approval. |
| Tidal | **No** | Developer Terms 3.0: may not "store, aggregate or create compilations or databases of TIDAL Content… and, in any event, you may not create stored databases". |
| YouTube / YouTube Music | **No** | Developer Policies III.E.4.c: stored data must be deleted or refreshed after 30 days. ytmusicapi is unofficial, so no developer terms apply. The consumer terms forbid automated access and redistribution. |
| MusicBrainz | **Yes, core data only** | Core data is CC0, including a recording's "title, artist credit, duration, ISRC… disambiguation comment, MBID". Tags, ratings, annotations and edit history are CC BY-NC-SA 3.0 and must stay out. |
| Wikidata | **Yes** | Structured data is CC0. It has properties for ISRC (P1243) and for Spotify (P2207), Deezer (P2724) and Apple Music (P10110) track IDs. |
| Discogs | **Yes, from the dumps** | The data dumps are CC0. The API terms also cap how long content may be stored, so use the dumps rather than the API. |
| Spotify Million Playlist Dataset | **No** | "You may not redistribute or make available any part or whole of this dataset." It also has no ISRCs. |

Sources:

- [Spotify Developer Terms v10](https://developer.spotify.com/terms) and
  [Developer Policy](https://developer.spotify.com/policy), both effective 15 May 2025
- [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).
  I could not find its date.
- [Deezer API terms of use](https://developers.deezer.com/termsofuse). The page is undated.
- [TIDAL Developer Terms 3.0](https://developer.tidal.com/documentation/guidelines-developer-terms-3_0),
  dated 6 May 2024
- YouTube [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) and
  [YouTube Terms](https://www.youtube.com/t/terms)
- MusicBrainz [data licence](https://musicbrainz.org/doc/About/Data_License) and
  [database page](https://musicbrainz.org/doc/MusicBrainz_Database)
- Wikidata [P1243](https://www.wikidata.org/wiki/Property:P1243)
- [Discogs data dumps](https://data.discogs.com/) and
  [API terms](https://support.discogs.com/hc/en-us/articles/360009334593)
- [Spotify Million Playlist Dataset](https://www.aicrowd.com/challenges/spotify-million-playlist-dataset-challenge)

**Further points:**

- **Machine-learning clauses.** Spotify bars using its content "to train a machine learning or
  AI model" (Terms IV.2.1.1, Policy III.14). Tidal bars using its content with "artificial
  intelligence services or tools". Measuring a hand-written matcher is not training, but these
  clauses rule out any later move to fit the matcher's weights on Spotify or Tidal data. They also
  bear on the LLM seam, which #104 decides.
- **Analysis clause.** Spotify Policy III.13 says "Do not analyze the Spotify Content… for any
  purpose". Matching is what the app is for, so a local test that runs the matcher is arguably part
  of operating it. A published accuracy study of Spotify metadata is harder to defend that way.
  This is a judgement, not a settled reading.
- **ISRCs themselves.** The ISRC Handbook (4th edition, A.14.6) says "assignment of an ISRC does
  not affect ownership in any way", and MusicBrainz publishes ISRCs as CC0. I found no IFPI
  statement on publishing ISRCs. A list of ISRCs taken from MusicBrainz carries no service's terms.
  The same list taken from Spotify would.
- **Even bare service IDs are arguable.** Spotify's and Tidal's "compilations or databases"
  clauses cover any Spotify or Tidal Content, and an ID is content. Service IDs should therefore be
  committed only where MusicBrainz or Wikidata already holds them as CC0 links.

## 3. Candidate sources of pairs

### Positives: same recording, same ISRC

| Source | How you get pairs | Notes |
| --- | --- | --- |
| **MusicBrainz** | `GET /ws/2/isrc/<isrc>?inc=artist-credits+releases+url-rels+work-rels` returns every recording with that ISRC, with its title, artist credit, length, releases and the URL links to service pages. | CC0. The hard limit is 1 request a second with a proper User-Agent ([API](https://musicbrainz.org/doc/MusicBrainz_API)), so about 25 minutes per 1,000 ISRCs. ISRCs are user-submitted, so expect a small rate of wrong ones. |
| **MusicBrainz canonical dumps** | Bulk version of the above, published on the 1st and 15th of each month | CC0 ([wiki](https://wiki.musicbrainz.org/Canonical_MusicBrainz_data)). Suits sampling at scale with no rate limit. |
| **Wikidata** | SPARQL over P1243 joined to P2207, P2724 and P10110 | CC0, but sparse. Most ISRCs are on singles and notable songs, which skews the sample towards hits. |
| **Spotify** | `GET /v1/search?q=isrc:<isrc>&type=track` | At most 10 results. In February 2026 Spotify removed `external_ids` from tracks for development-mode apps, then [restored it in March 2026](https://developer.spotify.com/documentation/web-api/references/changes/march-2026). Development mode now needs a Premium owner and allows at most five users ([February 2026](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)). **Unverified:** whether a new development-mode client gets `external_ids.isrc` today. Test it with a real key. |
| **Deezer** | `GET https://api.deezer.com/track/isrc:<isrc>` | Returns one track, with `title_version` and `isrc`. It answered a live call, but its documentation sits behind a login. |
| **Apple Music** | `GET /v1/catalog/{storefront}/songs?filter[isrc]=<isrc>` | "One ISRC value may return more than one song" ([docs](https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-songs-by-isrc)). Needs a paid developer account for the token. |
| **Tidal** | `GET https://openapi.tidal.com/v2/tracks?filter[isrc]=<isrc>` | One ISRC may return several tracks ([OpenAPI](https://tidal-music.github.io/tidal-api-reference/tidal-api-oas.json)). |
| **Local files / Plex** | TSRC (ID3) or ISRC (Vorbis) tags in a Picard-tagged library | Plex does not expose ISRC (`song-dict.md` §2). The file has to be read directly to label a Plex track. |

**In Apple, Tidal and MusicBrainz, one ISRC can map to several catalogue items.** That is
expected: compilations and regional releases keep the ISRC (ISRC Handbook §4.1). The dataset
should therefore store groups, not just pairs, and the test should pick a pair from each group.

### Traps: different recordings that look alike

MusicBrainz encodes most of the trap categories ADR-0022 names:

| Trap | Where MusicBrainz marks it |
| --- | --- |
| Cover | A recording-to-work "performance" relationship with the `cover` attribute, or the same work by another artist ([relationship](https://musicbrainz.org/relationship/a3005666-a872-32c3-ad06-98af558e99b0)) |
| Live vs studio | The same relationship with the `live` attribute. The disambiguation comment reads "live", plus date and venue ([style guide](https://musicbrainz.org/doc/Style/Recording)) |
| Radio edit, single edit, censored version | The recording-to-recording `edit` relationship ([types](https://musicbrainz.org/relationships/recording-recording)) |
| Remix | The recording-to-recording `remix` relationship |
| Re-recording (for example "Taylor's Version") | The same work by the same artist on a different recording |
| Same title, different song | No relationship. Search for recordings with an identical title and a different work. |
| **Remaster** | **Not encoded.** "Separate recordings should not be created for remastered tracks" ([style guide](https://musicbrainz.org/doc/Style/Recording)). The `remaster` relationship is deprecated. |
| Clean vs explicit | Probably the `edit` relationship ("censored"). Not verified. |

The remaster gap matters beyond sourcing. The ISRC Handbook gives a remaster a new ISRC only if it
"involved creative input" (`song-dict.md` Q7). In practice, services list "Song - Remastered 2011"
under either the original ISRC or a new one. So "same ISRC" does not reliably answer "same
recording" for remasters. And a user syncing a playlist almost certainly wants the remaster when
the original is missing. Remaster pairs (and possibly clean and explicit pairs) need their own
label rather than "match" or "no match". Deezer's `title_version` field (for example "Remastered
2011" on `GBUM71029604`) is a cheap way to find candidates in the local tier.

## 4. How to collect it

1. **Choose ISRCs.** Sample recordings from the MusicBrainz canonical dump that have an ISRC and at
   least one Spotify URL link. Stratify by decade and region, and include non-Latin scripts and
   tracks with several artists, so the sample is not all Anglophone hits. Bias part of the sample
   towards Cal's own library, because the Phase 1 slice is Spotify to Plex.
2. **Mine the traps.** For each sampled recording, follow `work-rels` to the work and pull up to a
   few sibling recordings that carry `cover` or `live`, or `edit` or `remix` links. Add a
   same-title search for unrelated songs.
3. **Write the CC0 tier.** Map each MusicBrainz recording to a song dict (title, artists, album,
   `durationMs`, `date`, `isrc`, `id.musicbrainz`) and record its label. Commit it as a fixture with
   a note that it is MusicBrainz data under CC0. The tier's weakness is that both sides of a pair
   come from one database with one style. To make up for it, add a hand-written set of service-style
   variants: "feat." in the title, "- Remastered 2011", "Flume & Kai" against `["Flume", "Kai"]`
   (`song-dict.md` Q5), and a year against a full date. A contributor writes each one by hand, so
   no service's terms apply.
4. **Build the local service tier.** A collector script reads the committed ISRC manifest and calls
   Spotify, Deezer and, if keys exist, Apple and Tidal by ISRC. It writes their song dicts to a
   git-ignored cache. Plex pairs come from reading the test server's file tags. The accuracy test
   runs against this cache when it is present and skips the tier when it is not.
5. **Label.** Positives carry the ISRC's group. Traps carry their category. Remasters and
   ambiguous cases carry the third label. Spot-check a random 5% by hand, because MusicBrainz ISRCs
   are user-submitted.

## 5. Where it lives

- **CC0 tier and hand-written cases:** committed under the matcher package's `test/fixtures/`
  (AGENTS.md: test data lives there). The licence note goes beside the data.
- **ISRC manifest and labels:** committed with the CC0 tier. ISRCs from MusicBrainz are CC0.
- **Service tier:** a git-ignored local cache, regenerated on demand and never pushed. That
  includes a private repo or a shared bucket: every closed service's clause is about keeping a
  compilation or passing it on, and a private repo is still both. YouTube's 30-day rule also means
  any ytmusicapi data would have to be refreshed or deleted within a month.
- **Consequence:** CI can run only the CC0 tier. The exit-gate figure on real service data is a
  local run with Cal's keys. That fits the roadmap, because the exit-gate `/verify` is already a
  manual step against the Plex test server.

## 6. Size

These are 95% intervals for a measured accuracy *p* over *n* pairs, computed with the Wilson score
interval: (p + z²/2n ± z√(p(1−p)/n + z²/4n²)) / (1 + z²/n), with z = 1.96. Use Wilson rather than
the normal approximation, which is symmetric and runs past 100% near the top.

| p | n = 100 | n = 400 | n = 1,000 |
| --- | --- | --- | --- |
| 0.95 | 88.8–97.9% | 92.4–96.7% | 93.5–96.2% |
| 0.99 | 94.6–99.8% | 97.5–99.6% | 98.2–99.5% |

**Recommendation:**

- **About 1,000 positive pairs** (recall, which measures whether the right song is found). That
  narrows the overall figure to about ±1.4 points at 95%.
- **At least 100 pairs per trap category**, at least 500 in all, across cover, live, edit, remix,
  re-recording and same-title. A wrong match puts the wrong song in a playlist, so the trap error
  rate is the figure users feel. With 100 per category and no errors, the rule of three bounds that
  category's error rate below 3% at 95%.
- **Per-slice minimums over a bigger total.** A 99% headline can hide a category the matcher always
  fails. The target #104 sets should be per category, or at least have a floor per category.
- **Precision is counted over predicted matches only,** so its *n* is the number of matches the
  matcher made, not the size of the dataset.

The collection cost is small. About 1,500 recordings plus their trap siblings is a few thousand
MusicBrainz calls, which takes about an hour at 1 request a second, or nothing from the dump.

## 7. Not verified

- Whether a new Spotify development-mode client receives `external_ids.isrc` today.
- The ListenBrainz licence text, seen only in search snippets. It is not needed for this design.
- Deezer's API documentation, which sits behind a login. The endpoint was confirmed by a live call.
- Whether the Discogs dumps carry ISRCs.
- How MusicBrainz models clean and explicit versions.
- The date of Apple's licence agreement, and of Deezer's terms.
