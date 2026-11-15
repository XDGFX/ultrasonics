# Research: the matcher rebuild, measured

**Date:** 2026-11-16
**Informs:** [#132](https://github.com/XDGFX/ultrasonics/issues/132) (the matcher, rebuilt on
record-linkage practice), its open questions 1–4
**Builds on:** [#117](https://github.com/XDGFX/ultrasonics/issues/117), the staged-rules matcher
from [#120](https://github.com/XDGFX/ultrasonics/issues/120), [`match-dataset.md`](match-dataset.md)
**Code:** `packages/matcher/experiment/` on branch `experiment/132-matcher-rebuild`. It is a
prototype that measures things and is not meant to ship. `src/` is untouched.

This prototypes each technique #132 proposes so that each can be switched on alone, and measures it
on the CC0 tier with the ISRC hidden, as the harness does. The service tier was not touched.

## 1. Summary

- **The baseline reproduces exactly.** On the full CC0 tier: recall 76.2%, precision 90.5%,
  remix rejection 68.5%, re-recording rejection 73.4% (§3).
- **Pairwise precision of 99% can't be reached on this tier with the ISRC hidden, by any scoring
  method.** Unmarked remixes and re-recordings agree with the original on title, artist and
  length to within a second. A Fellegi–Sunter score fitted to 99% precision on the tuning split
  keeps 9.5% recall on the held-out split. beets' and Picard's weighted distances fare no better.
  #132 is right to move these traps into a ranking figure.
- **Ranking is where the gain is.** The best hybrid ranks a wider band by release date and changes
  four things on the held-out candidate sets:
  - picks the original 82.5% against 74.0%;
  - picks the lookalike 1.3% against 9.4%;
  - picks the original 96.9% when the medium band is accepted outright;
  - loses nothing when the service lacks the original.
- **Two things help pairwise recall at the baseline's precision.** Transliteration with any-ascii,
  and Fellegi–Sunter weights for title, artist and length with u estimated from random pairs.
  Held out, recall rises from 74.3% to 79.2%, precision is unchanged at about 90%, every trap
  figure is identical and no positive is newly lost (P1, §4).
- **Things that didn't work:**
  - beets' 10 s length grace;
  - any widening of the 3 s length window;
  - album and year in the pairwise score;
  - title term frequency;
  - ISRC year and registrant as pairwise evidence;
  - ranking by ISRC year before release date.
- **Fellegi–Sunter u must come from ordinary non-matches, not from the traps.** Fitted on the
  traps, the weights learn how the tier was sampled: an equal title counts *against* a match, and
  a missing year counts for it. They then reach 95% recall at 89% precision, which looks good and
  means nothing (T1/T2, §5).

## 2. Method

- **Tier:** `test/fixtures/match-dataset/musicbrainz.json` (1,792 cases) plus the 28 hand-written
  cases, 1,820 in all, as `match.test.ts` measures them. ISRCs are stripped before every call.
- **Split, against overfitting:** each MusicBrainz case goes by `sha1("132|<recording a>|<recording
  b>|<category>")`. Those under 0.4 form the tuning split: 719 cases, 434 of them positives. Every
  other case, plus all the hand-written ones, forms the held-out split: 1,101 cases, 631 of them
  positives. All weights and thresholds are fitted on the tuning split only. Every table below gives
  the held-out figure, and §4 gives tuning against held-out for the headline variants. Cells are
  rate, then the 95% Wilson interval from `harness.ts`, then n.
- **Extra data, all CC0:** `experiment/fetch-recordings.ts` re-read each of the tier's 2,418
  recordings from the MusicBrainz search service, 20 MBIDs a request, taking each one's ISRCs
  and releases. 2,417 came back. That built the two sets #132 says the tier should gain:
  - **Two-ISRC positives (134; 56 for tuning, 78 held out):** a positive whose recording has a
    second ISRC in MusicBrainz, with that ISRC on side `b`.
  - **Candidate sets (356; 223 held out):** for each remix, re-recording, live and edit trap
    whose original MusicBrainz lists on another release:
    - the **source** is the original on that other release;
    - the **candidates** are the original as the tier has it, and the lookalike;
    - the candidate order is drawn from the seed, so `position` carries no signal.

    A second variant has only the lookalike, where the right answer is *nothing*.
- **Reproduce:**
  1. `bun experiment/fetch-recordings.ts` takes about 2 minutes and caches into
     `musicbrainz-cache/`.
  2. `bun experiment/run.ts` takes about 4 s. It writes `experiment/results.md`, which holds every
     table in full, including the tuning and full-tier versions.

## 3. Baseline today

`bun test src/match.test.ts` on `revival` at `0306e5b`:

| Figure | Rate | 95% interval | n |
|---|---|---|---|
| Recall | 76.2% | 73.5–78.6 | 1,065 |
| recall: plain | 76.6% | 73.9–79.1 | 1,027 |
| recall: remaster | 61.1% | 44.9–75.2 | 36 |
| recall: clean-explicit | 100.0% | 34.2–100.0 | 2 |
| Rejection: cover | 100.0% | 97.1–100.0 | 127 |
| Rejection: live | 94.5% | 89.1–97.3 | 127 |
| Rejection: edit | 96.9% | 92.2–98.8 | 127 |
| Rejection: remix | 68.5% | 60.0–75.9 | 127 |
| Rejection: re-recording | 73.4% | 65.2–80.3 | 128 |
| Rejection: same-title | 100.0% | 96.9–100.0 | 119 |
| Precision | 90.5% | 88.4–92.3 | 896 |

This matches the roadmap's accepted baseline.

## 4. Pairwise results (`match`), ISRC hidden, held-out split

| Variant | Recall | Precision | live | edit | remix | re-recording |
|---|---|---|---|---|---|---|
| **B0** shipped `match` | 74.3 [70.8–77.6] (631) | 90.0 [87.1–92.3] (521) | 93.4 (76) | 97.6 (82) | 71.8 (85) | 74.7 (83) |
| B1 B0 + transliteration | 76.1 [72.6–79.2] | 90.2 [87.4–92.5] | 93.4 | 97.6 | 71.8 | 74.7 |
| B2 B0, length cliff 10 s | 77.2 [73.7–80.3] | 83.8 [80.6–86.6] | 81.6 | 95.1 | 58.8 | 50.6 |
| B4 B0 + translit + 10 s, threshold refitted | 73.5 [70.0–76.8] | 83.9 [80.6–86.7] | 82.9 | 95.1 | 58.8 | 55.4 |
| W1 beets weights and bands (0.04 / 0.25), 10 s grace | 74.6 [71.1–77.9] | 80.4 [77.0–83.4] | 71.1 | 90.2 | 52.9 | 45.8 |
| W2 beets weights, bands fitted to 99% | 71.9 [68.3–75.3] | 83.6 [80.3–86.5] | 82.9 | 95.1 | 58.8 | 55.4 |
| W3 Picard weights, bands fitted to 99% | 0.0 [0.0–0.6] | – | 100 | 100 | 100 | 100 |
| F1 F–S (title, artist, length), fitted to 99% | 59.9 [56.0–63.7] | 94.7 [92.1–96.5] (399) | 96.1 | 100 | 87.1 | 91.6 |
| F5 F–S, all fields + translit, fitted to 99% on #132's match figure | 9.5 [7.5–12.0] | 100.0 [94.0–100.0] (60) | 100 | 100 | 100 | 100 |
| F6 F5, medium band accepted | 94.1 [92.0–95.7] | 78.6 [75.5–81.3] | 59.2 | 80.5 | 38.8 | 28.9 |
| **P1** F–S (title, artist, length) + translit, threshold at 90% tune precision | **79.2 [75.9–82.2]** | **90.6 [87.9–92.7]** (552) | 93.4 | 97.6 | 71.8 | 74.7 |
| P2 P1 + album and year | 78.4 [75.1–81.5] | 90.2 [87.4–92.4] | 90.8 | 93.9 | 67.1 | 83.1 |

Cover and same-title rejection stay at 95.8–100% in every variant, so they are left out of the
table; `results.md` has them.

**Tuning against held-out**, as a check on overfitting:

| Variant | Recall, tuning / held-out | Precision, tuning / held-out |
|---|---|---|
| B0 | 78.8 / 74.3 | 91.2 / 90.0 |
| B1 | 80.9 / 76.1 | 91.4 / 90.2 |
| P1 | 82.3 / 79.2 | 91.5 / 90.6 |
| F6 | 95.2 / 94.1 | 80.4 / 78.6 |

The unfitted baseline loses 4.5 points of recall between the splits, so the split itself is that
uneven. P1 loses 3.1, which leaves no sign that its fit overfits. P1 has 12 weights and one
threshold.

### What moved which misses (full tier)

The baseline misses 254 positives. Each is put under its first applicable cause: cross-script
first, then a length gap over 3 s, then a title below 0.85, then an artist below 0.85, then a
version marker.

| Variant | title differs (77) | length > 3 s (49) | cross-script (81) | artist differs (37) | marker (10) | newly missed |
|---|---|---|---|---|---|---|
| B1 transliteration | 7 | 0 | 12 | 1 | 0 | 0 |
| B2 length cliff 10 s | 0 | 33 | 0 | 0 | 0 | 0 |
| P1 | 21 | 0 | 23 | 2 | 0 | **0** |
| F6 F5, medium accepted | 65 | 37 | 64 | 30 | 0 | 0 |

**Recall by script**, held out:

| Variant | Latin (399) | same non-Latin script (181) | cross-script (51) |
|---|---|---|---|
| B0 | 86.0 [82.2–89.0] | 68.5 [61.4–74.8] | 3.9 [1.1–13.2] |
| B1 | 86.0 | 71.3 | 15.7 [8.2–28.0] |
| P1 | 86.5 | 77.3 [70.7–82.8] | 29.4 [18.7–43.0] |

A pair counts as cross-script when side `a`'s title and artist share no non-Latin script with
side `b`'s. Kana and kanji count as one script.

### Fitted Fellegi–Sunter weights

These are log₂ m/u from the tuning split, with u taken from random pairs, for F5. P1 uses the
title, artist and length rows of its own fit.

- **title:** equal +9.0, ≥0.9 +6.6, ≥0.75 +6.7, ≥0.5 +4.3, <0.5 −3.6
- **artist:** equal +7.9, ≥0.9 +5.1, ≥0.75 +5.8, ≥0.5 +2.1, <0.5 −4.6
- **length:** ≤1 s +6.1, ≤3 s +3.2, ≤10 s −0.6, ≤30 s −5.7, >30 s −7.0
- **album:** equal +8.0, ≥0.7 +4.8, other −0.5
- **year gap:** 0 +3.6, 1–2 −0.2, 3–9 −1.2, ≥10 −1.7
- **missing:** 0 (the null level)

The length row is the most useful single output. Agreement is strong evidence up to 3 s, roughly
neutral at 3–10 s, and a near-veto beyond 10 s. On this tier the shipped 3 s cliff sits about
where the evidence turns. A soft 3–10 s zone recovers none of the 49 length misses at 90%
precision, because the remixes, re-recordings and live takes sit in the same gap.

## 5. What didn't work

- **Widening the length window.** beets' defaults are `track_length_grace: 10` and
  `track_length_max: 30`. A cliff at 10 s recovers 33 of the 49 length misses. It also costs 12–24
  points of remix, re-recording and live rejection (B2 against B0, held out). The gap between positives, 3.0 s at
  p95 and 9 s at p99, overlaps the gap to lookalikes. beets' grace was set for whole-album
  matching, where track count and order carry the evidence.
- **Album and year in the pairwise score.**
  - They help reject lookalikes: re-recording rejection is 83.1% in P2 against 74.7% in P1.
  - They also cost positives, because one recording on two releases differs in album by design:
    212 of 852 positives are five or more years apart.
  - The net effect at equal precision is −0.8 recall, −4.7 points on remix rejection and −3.7 on
    edit rejection.
  - They earn their keep in ranking (§6), not in `match`.
- **Picard's weights.** Picard weights title 13, length 10, album 5, artist 4 and date 4,
  combined as similarity × 0.9 + preference × 0.1. Its length score falls to zero at 30 s, so a
  remix and the original score alike. No threshold reaches 99% precision. Picard ranks files
  against releases, and album weight makes sense there. Here it doesn't.
- **Title term frequency** (Splink's adjustment, log₂(u_level / tf)). The tuning split's 988
  recordings carry 730 distinct titles, 495 of them held by one recording only, so the adjustment
  is close to a constant bonus for an equal title. That bonus raises recall a little (F3 against F4: 9.5% to
  13.9%), and the bonus lands on lookalikes too: remix rejection falls to 96.5%. A real "Intro"
  penalty needs a title-frequency table from a much larger corpus.
- **Fellegi–Sunter with u taken from the traps (T1 and T2).**
  - The fit gave an equal title −0.05, a title below 0.5 +0.83, and a missing year +3.8. Positives
    lack dates more often than the traps do in this tier.
  - With the medium band accepted, T2 reaches 94.9% held-out recall at 89.5% precision. That looks
    like the best pairwise result, but it is the fit learning the sampling.
  - u should come from ordinary non-matches, which is how Fellegi & Sunter (1969) define it and
    how Splink estimates it, by random sampling. A missing field should weigh 0. F1 to F6 and P1
    do both.
- **ISRC year and registrant as pairwise evidence.** See §7.
- **A medium band as a match.** F6 reaches 94.1% recall. It also accepts 61% of remixes and 71%
  of re-recordings. On the full tier the medium band holds 897 positives and 263 traps. It is
  too large and too mixed to stand as a decision.

## 6. Ranking (`bestMatch`), ISRC hidden, held-out candidate sets

| Picker | picks original | picks lookalike | picks nothing | lookalike only: picks nothing ✓ |
|---|---|---|---|---|
| **B0** shipped `bestMatch` | 74.0 [67.9–79.3] | 9.4 | 16.6 | 82.1 [76.5–86.5] |
| B0 acceptance, evidence first (album, ISRC year, date) | 78.9 [73.1–83.8] | 4.5 | 16.6 | 82.1 |
| B0 acceptance, album only | 74.0 | 9.4 | 16.6 | 82.1 |
| F5, strong band only | 0.0 | 0.0 | 100.0 | 100.0 |
| F5, medium accepted, score first (#132's order) | 85.7 [80.4–89.6] | 13.0 | 1.3 | 48.9 [42.4–55.4] |
| F5, medium accepted, evidence first | **96.9 [93.7–98.5]** | 1.8 | 1.3 | 48.9 |
| F5, medium accepted, album only | 83.9 | 14.8 | 1.3 | 48.9 |
| **H1** P1 gates, then F5 medium-or-better ranked evidence first | **82.5 [77.0–86.9]** | **1.3** | 16.1 | **82.1** |

n = 223 for every cell: 57 remix, 67 re-recording, 54 live, 45 edit. Under H1 the lookalike
share is 0.0% for remix and re-recording, against 15.8% and 13.4% for B0.

- **Release date does the work.** "Prefer the earlier release" turns 13.0% wrong picks into
  1.8%. Album alone does nothing here, because the lookalike shares the source's album title in
  only 9 of the 356 sets. That is a limit of this proxy, not evidence against album. The album
  remix case #132 describes, where 14 of 40 share an album, needs the real candidate sets.
- **Order matters.** #132's order (score, then album, then ISRC year, then position) lets a
  lookalike that scores a hair higher win. Evidence has to come before score among candidates
  that pass the gate.
- **The gate matters as much.** Accepting medium outright reaches 96.9%. It also picks the
  lookalike in 51% of the sets where the original isn't on the service. H1 lets the strict rule
  decide *whether* a match exists and the wider band decide *which* candidate.
  - H1 is better than B0 on all three counts, the lookalike-only case included.
  - Its 16.1% "nothing" is the original failing P1, because its title or length differs on the
    other release.
- **Position was not measured.** The sets' order is random by construction, so service result
  order needs the service tier.

## 7. ISRC as evidence (ISRC visible)

How often two ISRCs differ by registrant and by year code, for pairs that really are one
recording and for each kind of trap:

| Pairs | n | same registrant | year codes ≥ 5 apart |
|---|---|---|---|
| Two-ISRC positives (one recording) | 134 | 49 (37%) | 45 (34%) |
| re-recording traps | 125 | 14 (11%) | 106 (85%) |
| remix traps | 125 | 79 (63%) | 57 (46%) |
| live traps | 125 | 76 (61%) | 44 (35%) |
| edit traps | 125 | 118 (94%) | 4 (3%) |
| cover traps | 125 | 5 (4%) | 93 (74%) |

- **Year codes ≥ 5 apart is weak evidence.** One recording under two ISRCs shows a gap that wide
  a third of the time. For re-recordings the likelihood ratio is 0.85 / 0.34 ≈ 2.5, about 1.3
  bits, and for remixes and live takes it is close to 1. The IFPI handbook (4th ed., 2021, §3.3.3)
  explains why: the year of reference "identifies the year in which the ISRC is assigned", and
  the year of recording "should be obtained from the metadata … and not from the Year of
  Reference element". Reissues get fresh ISRCs.
- **In `match`:** adding the ISRC field (F7) leaves two-ISRC recall unchanged at 2.6% (n = 78),
  because the strong band is that strict, and drops held-out remix rejection from 100% to 96.4%.
  The fitted weights (log₂ m/u) range from −0.6 for another registrant ≥ 5 years apart to +1.3
  for another registrant ≤ 1 year apart. That is noise next to the ±9 of the title and artist
  weights.
- **In `bestMatch`:** these are the 101 sets where the source carries the original's *other*
  ISRC.
  - Ranking by ISRC year before release date picks the original 71.3% of the time and the
    lookalike 26.7%.
  - Date before ISRC year gives 94.1% and 4.0%.
  - Prefer the earlier release date, and use ISRC year at most as a later tie-break.
- **The shipped matcher is unaffected by an unequal ISRC,** because it ignores it. With ISRCs
  visible it recalls 57.7% of the two-ISRC positives. An equal ISRC stays the hard match it is.

## 8. Suggested answers to #132's open questions

1. **Does a medium match reach the user?** Not in this spec.
   - On the CC0 tier, any band wide enough to take the positives the strict rule misses also takes
     about half the unmarked lookalikes. F6 accepts 263 traps alongside 897 positives in its medium
     band.
   - As a review queue it would hold most of the matches: F5's medium band holds 897 of the 1,065
     positives, and more than one pair in five in it (263 of 1,160) is a lookalike. That is too many to review and too
     mixed to trust.
   - The medium band is still useful *inside* `bestMatch` to choose among candidates once a strict
     match exists (H1). That needs no change to `OutputResult` or the plugin SDK.
   - Measure the band's size on the service tier before reconsidering it.
2. **Does `bestMatch` need the source's album?** It needs the source's **date** more. Both are
   already on the source `Song` it receives, so there is no SDK change. Album was untestable on
   this proxy. Keep it as the first tie-break, as #132 says, and measure it on real candidate sets.
3. **Targets for each figure.** These are numbers this experiment supports. A target should be
   met by the lower bound of the interval on held-out data.
   - **Pairwise precision with the ISRC hidden.** 99% is out of reach with these fields: the best
     is 9.5% recall at that precision. Hold the precision floor at today's 90% and raise the
     recall floor to 79% held out (P1). Count marker-carrying and length-gap traps in `match`'s
     figure, and move the unmarked remix and re-recording traps to ranking, as #132 proposes.
   - **Ranking figure.** Picks the original ≥ 80%, picks a lookalike ≤ 2%, and when only the
     lookalike exists, picks nothing ≥ 80%. H1 has 82.5 / 1.3 / 82.1. #117's ≥ 95% "picks the
     original" is reachable only by accepting lone lookalikes (F6), so it should not be the target.
   - **ISRC visible.** The two-ISRC positives should be their own recall figure. Each trap's
     rejection is reported with ISRCs visible, and an equal ISRC is a hard match. Don't set a
     target for ISRC-as-evidence; on these numbers it shouldn't be built.
4. **Does transliteration change what counts as a hit?** It should have its own, lower target.
   - Cross-script recall rises from 3.9% to 29.4% (n = 51) and stays low.
   - any-ascii folds Japanese kanji to *Mandarin* pinyin (its README: 埼玉県 → "QiYuXian") and
     hangul syllable by syllable (폭포의 아래 → "PogPoUi ALae").
   - 75 of the misses are translations, which no table can fix.
   - Report cross-script recall alongside the other figures with a target of about 25% (P1's lower
     bound is 18.7%). Leave the rest to the alias enricher that #132 already scopes out.

## 9. Recommendation

Rebuild `match` as P1, which makes three changes:

- Fellegi–Sunter weights for title, artist and length, fitted by a committed script with u from
  random pairs and 0 for a missing field.
- any-ascii transliteration.
- A threshold set to today's precision.

Its length bands replace the 3 s cliff but sit in the same place. Rebuild `bestMatch` as H1:

- A strict `match` decides whether there is a match.
- Candidates in the medium band or above are ranked by album, then **release date**, then score,
  then position. The ISRC year comes last if it is used at all.

Drop the ISRC-as-evidence field, beets' length grace, and album and year from the pairwise score.
All of this needs the service tier's verdict before it lands. MusicBrainz track lengths agree more
closely than services do (≤ 1 s is worth +6.1 bits here), so the length weights are the figure
most likely to move.

## 10. Limits of this experiment

- **The candidate sets are a proxy.** They are built from the trap pairs and the original's other
  release, not from a real service search. Position can't be tested, and album barely can.
- **The two-ISRC positives are few:** 134, of which 78 are held out.
- **Results depend on when the data was fetched.** MusicBrainz data was fetched on 2026-11-16.
  The release lists the search service returns may be truncated, and a refetch can differ
  slightly.
- **The tier's precision isn't real-world precision.** Traps make up 41% of the tier's pairs (755 of
  1,820) by construction, and precision depends on that mix. The service tier gives the figure that counts.

## Sources

- I. P. Fellegi and A. B. Sunter, "A Theory for Record Linkage", *JASA* 64(328):1183–1210, 1969,
  doi:10.1080/01621459.1969.10501049. These are the m/u weights, log m/u, summed per field.
- Splink, theory guide (`docs/topic_guides/theory/fellegi_sunter.md` at `f319070`) and
  [term-frequency adjustments](https://moj-analytical-services.github.io/splink/topic_guides/comparisons/term-frequency.html).
  These give log₂ m/u, u from random sampling, and the term-frequency adjustment. MIT.
- beets, [`beets/autotag/distance.py`](https://github.com/beetbox/beets/blob/ee6e08a7c85f7c5ae16ad8b5d5953a04bf633952/beets/autotag/distance.py)
  and [`config_default.yaml` L173–211](https://github.com/beetbox/beets/blob/ee6e08a7c85f7c5ae16ad8b5d5953a04bf633952/beets/config_default.yaml#L173-L211)
  at `ee6e08a`. MIT. They give:
  - track_title 3, track_artist 2 and track_length 2;
  - grace 10 s and max 30 s;
  - strong 0.04 and medium 0.25;
  - `string_dist`, which uses unidecode.
- MusicBrainz Picard, [`picard/file.py` L140–161](https://github.com/metabrainz/picard/blob/dc89c799481ed81f5a26221852ffa8f3ebcdb431/picard/file.py#L140-L161)
  and [`picard/matching.py`](https://github.com/metabrainz/picard/blob/dc89c799481ed81f5a26221852ffa8f3ebcdb431/picard/matching.py)
  at `dc89c79`. GPL-2.0. They give:
  - title 13, length 10, album 5, artist 4 and date 4;
  - length scored as 1 − min(Δ, 30 s) / 30 s.
- spotDL, [`spotdl/utils/matching.py`](https://github.com/spotDL/spotify-downloader/blob/58ced9af69dce17d33ff280bafbcc917a9dba0aa/spotdl/utils/matching.py)
  at `58ced9a`. MIT. It romanises Japanese with pykakasi and penalises version words with a
  forbidden-word list.
- any-ascii 0.3.3, ISC ([README](https://github.com/anyascii/anyascii/blob/389992a997665f77aced7e09839c9d1de0296d4f/README.md)).
  Added to `@ultrasonics/matcher` on the experiment branch only.
- IFPI, [*ISRC Handbook*](https://www.ifpi.org/wp-content/uploads/2021/02/ISRC_Handbook.pdf), 4th
  ed., 2021, §3.3.3, on the year of reference.
- MusicBrainz web service, core data (CC0), recording search by `rid`.
