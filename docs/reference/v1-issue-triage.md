# v1 issue triage

Every open issue on [`XDGFX/ultrasonics`](https://github.com/XDGFX/ultrasonics/issues) (37 as of
**2026-10-15**), read in full with comments and sorted by what it means for the 2.0 rewrite. Map
ticket [009](../plans/tickets/009-issue-triage.md) resolves here. The backlog is the only record of
what real users hit, so the deliverable is the **must still work** list below. Labels and closes come
second. **Nothing here has been applied to GitHub yet:** the labels, comments and closes are drafted
for Cal to run by hand.

[I] = an issue Cal opened himself as a v1 to-do. Every other issue came from a user. The open PRs
were skimmed too, and two of them matter: [#35](https://github.com/XDGFX/ultrasonics/pull/35) has
already merged the systemd unit that #8 asks for, and
[#45](https://github.com/XDGFX/ultrasonics/pull/45), a community TIDAL plugin with 56 comments, holds
user requests that appear in no issue.

---

## Must still work in v2

Domain behaviours that real users hit and that the rewrite has to answer. Each one is written to be
lifted into a spec's acceptance criteria. Of the ticket's suggested examples, **#36, #47 and #56 are
confirmed**. **#3 is already answered** by ADR-0011, so it only needs verifying. **#5 is weak**: it
is a to-do Cal filed, no user ever hit it, and 016 resolves it by design (see §6).

1. **An empty result is not a failure.** When none of a playlist's songs match, the output skips that
   playlist with a warning and the run carries on with the rest. When an input has nothing new to
   emit, the run ends as a successful no-op. In v1, Plex refuses to create an empty playlist, which
   aborted an 82-playlist run at playlist 13. —
   [#36](https://github.com/XDGFX/ultrasonics/issues/36) (from closed #33),
   [#10](https://github.com/XDGFX/ultrasonics/issues/10) · *Plex output plugin (Phase 1); applet
   runner.*
2. **One bad song or playlist never aborts the run.** An item that cannot be read, searched, matched
   or written is skipped and reported, and the remaining playlists still sync. In v1, every one of
   these failures killed the whole run. —
   [#38](https://github.com/XDGFX/ultrasonics/issues/38),
   [#29](https://github.com/XDGFX/ultrasonics/issues/29),
   [#49](https://github.com/XDGFX/ultrasonics/issues/49),
   [#56](https://github.com/XDGFX/ultrasonics/issues/56) · *Applet runner and every plugin; a
   conformance-test case.*
3. **The fuzzy ratio always has a value.** A blank or omitted `fuzzyRatio` resolves to the default
   of 90 and can never crash a run. Plex beta's output was the one place in v1 that skipped the
   `or 90` fallback. This was the most-reported crash in the backlog. —
   [#47](https://github.com/XDGFX/ultrasonics/issues/47),
   [#54](https://github.com/XDGFX/ultrasonics/issues/54) (duplicate),
   [#49](https://github.com/XDGFX/ultrasonics/issues/49),
   [#32](https://github.com/XDGFX/ultrasonics/issues/32) · *Plex output plugin settings (Phase 1);
   settings forms, ticket 016 (see the trap in §6).*
4. **Every input emits a valid song dict, and a violation names the plugin.** v1's Plex beta input
   gives each playlist a `title` key instead of `name` (still true on `master`), which broke every
   downstream output with `KeyError: 'name'`. Spotify's input strips empty fields, so a track with a
   blank name reached Plex with no `title` at all. —
   [#59](https://github.com/XDGFX/ultrasonics/issues/59),
   [#32](https://github.com/XDGFX/ultrasonics/issues/32),
   [#38](https://github.com/XDGFX/ultrasonics/issues/38) · *Song-dict Zod port (Phase 0); the
   conformance test (Phase 2 gate).*
5. **The Spotify input copes with odd playlist items.** Local files have a null `id`. Removed,
   unavailable and episode items come back as a null `track`. Some tracks have no artists. All of
   these are skipped or carried without an id, with a warning, and none of them aborts the read. In
   v1, the error handler itself crashed on a null track. —
   [#29](https://github.com/XDGFX/ultrasonics/issues/29),
   [#30](https://github.com/XDGFX/ultrasonics/issues/30) (the "Invalid spotify id" lines) · *Spotify
   plugin, input (Phase 1).*
6. **Service search survives real-world titles.** An album or title containing `:`, quotes or curly
   quotes (`“Heroes”`, `Let’s Dance`, `God, Forgive These Bastards: Songs From…`) neither produces a
   400 nor goes unmatched. A 400 on one search skips that song and is never treated as an expired
   token. Mainstream tracks (Bowie, Queen) must match, which belongs in a fixture. —
   [#56](https://github.com/XDGFX/ultrasonics/issues/56) · *The shared Spotify search helper (Spotify
   output, spotify-mixer; Phases 1–2). Centralise it with fuzzymatch's cutoff regexes, as
   `legacy-architecture.md` already says.*
7. **Non-ASCII works end to end.** Files are written as UTF-8. Playlist names are sanitised into
   valid filenames, including the characters Windows forbids. Local playlists read an `.m3u` that is
   not UTF-8 (latin-1 is a legal `.m3u`) and ignore hidden files. —
   [#29](https://github.com/XDGFX/ultrasonics/issues/29),
   [#49](https://github.com/XDGFX/ultrasonics/issues/49) · *custom-file, local-playlists
   (Phase 2).*
8. **A run reports what actually happened.** A run whose output failed to write is not reported as
   successful. In v1, all 15 playlists returned Plex 500s and the applet still logged "completed
   successfully". The run shows its status live, records how many songs matched against how many
   were supplied for each playlist, and its log opens with the applet's ID, its plugins in order, and
   why it ran. All of it is visible in the UI, not only in the container log. —
   [#30](https://github.com/XDGFX/ultrasonics/issues/30),
   [#6](https://github.com/XDGFX/ultrasonics/issues/6) [I],
   [#9](https://github.com/XDGFX/ultrasonics/issues/9) [I],
   [#20](https://github.com/XDGFX/ultrasonics/issues/20) [I] · *Applet runner and minimal UI
   (Phase 1). §6 covers the SDK gap.*
9. **It works behind an HTTPS reverse proxy.** No redirect drops the user to `http://`: honour
   `X-Forwarded-Proto` and use relative redirects. Ideally it is also served under a URL subpath,
   which a SWAG user asked about. —
   [#37](https://github.com/XDGFX/ultrasonics/issues/37) · *Server (Phase 1); ticket 011.*
10. **The Plex input filters by title before fetching songs.** v1's Plex beta already does this, so
    keep it. —
    [#15](https://github.com/XDGFX/ultrasonics/issues/15) [I] · *Plex plugin, input.*
11. **Triggers combine with OR.** Already decided. Verify it, don't build it. —
    [#3](https://github.com/XDGFX/ultrasonics/issues/3) [I] · *ADR-0011; scheduler, ticket 015.*

---

## Triage table

| # | Title | Bucket | Reason |
|---|---|---|---|
| [3](https://github.com/XDGFX/ultrasonics/issues/3) | Trigger plugins run sequentially, instead of in parallel if more than one | Preserve | [I] Answered by ADR-0011 (OR, hardcoded). Close when 2.0 ships. Must-still-work #11. |
| [4](https://github.com/XDGFX/ultrasonics/issues/4) | An error while building a playlist will kick the user back to a blank homescreen | Dies with v1 | [I] A v1 UI failure mode. The Vue UI is new. |
| [5](https://github.com/XDGFX/ultrasonics/issues/5) | Global settings do not work with radio or select options | Preserve | [I] No user report. 016's single renderer resolves it. Close when 016 lands. |
| [6](https://github.com/XDGFX/ultrasonics/issues/6) | Update homepage when an applet completes (or fails) running | Preserve | [I] Live run status. Must-still-work #8. |
| [7](https://github.com/XDGFX/ultrasonics/issues/7) | Add confirmation on UI when settings are updated, or applets are saved | Dies with v1 | [I] Basic v1 UI polish. The Vue UI is new. |
| [8](https://github.com/XDGFX/ultrasonics/issues/8) | Create a systemd file for running on Linux | Dies with v1 | Already done: PR #35 merged the unit. v2 packaging is Phase 4. |
| [9](https://github.com/XDGFX/ultrasonics/issues/9) | Improve error catching for plugins, and general logging… | Preserve | [I] Run errors visible in the UI. Must-still-work #8. |
| [10](https://github.com/XDGFX/ultrasonics/issues/10) | Create custom error for plugins to deliberately stop applet run | Preserve | [I] "Nothing new" must end as success, not error. Must-still-work #1. |
| [12](https://github.com/XDGFX/ultrasonics/issues/12) | Auto-retry running an applet after a failure | Uncertain | [I] Ticket 015 should decide whether retry exists at all. |
| [13](https://github.com/XDGFX/ultrasonics/issues/13) | Add name filter for plugin selection screen | Dies with v1 | [I] v1 UI. Around 12 plugins at parity, so a filter is a nicety for the new UI. |
| [14](https://github.com/XDGFX/ultrasonics/issues/14) | Implement update checker… | Uncertain | [I] A self-host concern only (hosted needs none). A Phase 4 call. PR #45 attempted it. |
| [15](https://github.com/XDGFX/ultrasonics/issues/15) | up_plex: Filter playlist titles before getting their songs | Preserve | [I] Plex beta already does this. Keep it in the port. Must-still-work #10. |
| [20](https://github.com/XDGFX/ultrasonics/issues/20) | Logs not clear enough | Preserve | [I] The run log opens with applet context. Must-still-work #8. Related to #9. |
| [29](https://github.com/XDGFX/ultrasonics/issues/29) | Spotify to .txt file | Preserve | UTF-8 writes, filename sanitising, Spotify null tracks. Must-still-work #2, #5, #7. |
| [30](https://github.com/XDGFX/ultrasonics/issues/30) | Spotify to Plex | Dies with v1 | Legacy `plex` path translation and a configure-page bug, neither ported. Still evidence for must-still-work #8. |
| [31](https://github.com/XDGFX/ultrasonics/issues/31) | Spotify to Plex | Dies with v1 | `/configure_plugin` returned `None`. Fixed in 1.1.0, and Flask is gone in v2. |
| [32](https://github.com/XDGFX/ultrasonics/issues/32) | No playlist found in Plex | Uncertain | Its crashes duplicate #47 and #59. What remains is poor Plex→Spotify matching (1,200 of 10k) and a request for beets-style manual matching. No phase owns that yet. |
| [36](https://github.com/XDGFX/ultrasonics/issues/36) | Plex - Handle scenario where a playlist has zero songs | Preserve | Must-still-work #1. Confirmed in #33's traceback. |
| [37](https://github.com/XDGFX/ultrasonics/issues/37) | Keeps redirecting to HTTP when behind HTTPS proxy | Preserve | Reverse-proxy correctness. Must-still-work #9. Ticket 011. |
| [38](https://github.com/XDGFX/ultrasonics/issues/38) | ERROR, title | Preserve | A song with no `title` crashed a large Plex sync. Must-still-work #2, #4. |
| [39](https://github.com/XDGFX/ultrasonics/issues/39) | Error during install | Dies with v1 | The python-Levenshtein C build. **Duplicate of #65.** |
| [41](https://github.com/XDGFX/ultrasonics/issues/41) | Yunohost package | Uncertain | A packaging request. Phase 4 should decide which platforms to target. |
| [43](https://github.com/XDGFX/ultrasonics/issues/43) | YouTube playlists? | Phase 3 feature | YouTube Music in the roadmap. Someone was still asking in Apr 2026. |
| [44](https://github.com/XDGFX/ultrasonics/issues/44) | Tidal plugin | Phase 3 feature | Tidal in the roadmap. Community attempt in PR #45. |
| [47](https://github.com/XDGFX/ultrasonics/issues/47) | Entering no fuzzy search ratio for Plex crashes the applet | Preserve | Must-still-work #3. **Canonical** for #54, and for the second half of #49. |
| [48](https://github.com/XDGFX/ultrasonics/issues/48) | Unable to start app no nameservers | Dies with v1 | An eventlet/dnspython import-time crash. No Python in v2. |
| [49](https://github.com/XDGFX/ultrasonics/issues/49) | Can't sync local playlist with Plex | Preserve | A non-UTF-8 or hidden `.m3u` kills the read. Its second error duplicates #47. Must-still-work #2, #7. |
| [50](https://github.com/XDGFX/ultrasonics/issues/50) | . | Dies with v1 | Empty. Probably filed by accident (the same user asked how to install on PR #45 that day). |
| [52](https://github.com/XDGFX/ultrasonics/issues/52) | Add option to retrieve poster from spotify playlist | Phase 3 feature | Playlist artwork. Needs a song-dict field, which is ADR-level (§6). |
| [54](https://github.com/XDGFX/ultrasonics/issues/54) | Unable to sync Spotify to Plex | Preserve | **Duplicate of #47** (identical traceback). Close as a duplicate. |
| [55](https://github.com/XDGFX/ultrasonics/issues/55) | Status of Apple Music? | Phase 3 feature | Apple Music in the roadmap. +1s as late as Feb 2025. |
| [56](https://github.com/XDGFX/ultrasonics/issues/56) | Cannot find easily searchable songs & crashing when seraching for one song | Preserve | Search-query escaping, and a 400 mistaken for token expiry. Must-still-work #2, #6. The token-renew half was the proxy, which dies. |
| [58](https://github.com/XDGFX/ultrasonics/issues/58) | Suggest to loosen the dependency on fuzzywuzzy | Dies with v1 | An automated dependency-analysis request. fuzzywuzzy is gone in v2. |
| [59](https://github.com/XDGFX/ultrasonics/issues/59) | plugins - ERROR - 'name' | Preserve | The Plex input emits `title` instead of `name`. Must-still-work #4. |
| [61](https://github.com/XDGFX/ultrasonics/issues/61) | Cant Authorise spotify | Dies with v1 | The dead `ultrasonics-api` proxy (Spotify and Deezer). v2 uses BYO credentials. |
| [65](https://github.com/XDGFX/ultrasonics/issues/65) | Cpp installation needed for python-Levenshtein | Dies with v1 | C build toolchain. **Canonical** for #39. |
| [66](https://github.com/XDGFX/ultrasonics/issues/66) | Version issue in Flask 2.0.1 with Werkzeug | Dies with v1 | Unpinned Flask/Werkzeug. PR #67 pins them. v2 has a lockfile. |

**Counts:** Dies with v1 **13** · Preserve **16** · Phase 3 feature **4** · Uncertain **4** = 37.

**Duplicates:** #54 → #47 · the second error in #49 → #47 · the crashes in #32 → #47 and #59 · #39 →
#65.

---

## Proposed labels

| Label | Colour | Meaning |
|---|---|---|
| `v2: dies-with-v1` | `6a737d` grey | Specific to the Python/Flask codebase or the dead proxy. Closed with a note. |
| `v2: preserve` | `0e8a16` green | A domain behaviour 2.0 must answer. Stays open until 2.0 ships it. |
| `v2: phase-3` | `1d76db` blue | A requested service or feature planned for after parity. |
| `v2: uncertain` | `fbca04` yellow | Not yet placed. Left open, with the reason in this doc. |

```zsh
#!/usr/bin/env zsh
# Creates the four v2 triage labels and applies them. Safe to re-run (--force updates).
set -euo pipefail
R=XDGFX/ultrasonics

gh label create 'v2: dies-with-v1' -R $R --color 6a737d --force --description 'Specific to v1 code or the dead proxy; closed with a note'
gh label create 'v2: preserve'     -R $R --color 0e8a16 --force --description 'Domain behaviour the 2.0 rewrite must answer'
gh label create 'v2: phase-3'      -R $R --color 1d76db --force --description 'Requested service/feature, planned post-parity'
gh label create 'v2: uncertain'    -R $R --color fbca04 --force --description 'Not yet placed; see docs/reference/v1-issue-triage.md'

dies=(4 7 8 13 30 31 39 48 50 58 61 65 66)
preserve=(3 5 6 9 10 15 20 29 36 37 38 47 49 54 56 59)
phase3=(43 44 52 55)
uncertain=(12 14 32 41)

for n in $dies;      do gh issue edit $n -R $R --add-label 'v2: dies-with-v1'; done
for n in $preserve;  do gh issue edit $n -R $R --add-label 'v2: preserve';     done
for n in $phase3;    do gh issue edit $n -R $R --add-label 'v2: phase-3';      done
for n in $uncertain; do gh issue edit $n -R $R --add-label 'v2: uncertain';    done

# Mark duplicates with the existing label
for n in 39 54; do gh issue edit $n -R $R --add-label duplicate; done
```

---

## Draft close comments

**Default template**, for user-filed issues in the Dies with v1 bucket:

> Thanks for reporting this, and sorry it sat unanswered for so long.
>
> ultrasonics is being rewritten from scratch as 2.0 (TypeScript and Bun, replacing the Python/Flask
> codebase). The work is happening on the [`revival`](https://github.com/XDGFX/ultrasonics/tree/revival)
> branch. This issue comes from the v1 code or its dependencies, which won't exist in 2.0, so I'm
> closing it rather than leaving it open with no fix coming.
>
> I can't give a date yet, but if you're still interested, watching the repo is the best way to hear
> when 2.0 is ready to try. If the same problem turns up in 2.0, please open a fresh issue.

**Variants:**

- **#61 (proxy)**, replacing the middle paragraph with:
  > v1 fetched Spotify and Deezer keys from a small hosted proxy (`ultrasonics-api`), and that proxy
  > stopped working in late 2022. That's why authorisation fails, and there's no fix for v1. 2.0
  > removes the proxy completely: you'll register your own Spotify app and paste in its client ID,
  > which keeps working no matter what happens to any server of mine.
- **#8 (already done)**, a single line: "A systemd unit was added in #35, so this is done for v1.
  2.0 will ship its own packaging. Closing."
- **#50 (empty)**, a single line: "Closing as it looks like this was opened by accident. Feel free
  to open a new issue if there was something you meant to report."
- **#39 and #65 (build toolchain):** use the default, adding "2.0 has no C-compiled dependencies, so
  this class of install failure goes away."
- **#66:** use the default, adding "Thanks for the diagnosis and for #67. For anyone still on v1,
  the `xdgfx/ultrasonics:1.2.0` Docker image is the workaround mentioned above."
- **Cal's own to-dos (#4, #7, #13):** a single line: "Superseded by the 2.0 rewrite on `revival`.
  The new UI is built from scratch." No apology needed.
- **#54 (duplicate, Preserve bucket):** "Same crash as #47, so I'm closing this as a duplicate.
  Please follow #47. It stays open, and it's on the list of things 2.0 must get right."

```zsh
#!/usr/bin/env zsh
# Closes the Dies-with-v1 issues and the #54 duplicate. Edit the bodies before running.
set -euo pipefail
R=XDGFX/ultrasonics
D=/tmp/ultrasonics-close   # put default.md, proxy.md, done.md, empty.md, toolchain.md, flask.md, own.md, dup.md here

for n in 30 31 48 58; do gh issue close $n -R $R --reason 'not planned' --comment "$(<$D/default.md)"; done
for n in 39 65;       do gh issue close $n -R $R --reason 'not planned' --comment "$(<$D/toolchain.md)"; done
gh issue close 61 -R $R --reason 'not planned' --comment "$(<$D/proxy.md)"
gh issue close 66 -R $R --reason 'not planned' --comment "$(<$D/flask.md)"
gh issue close 8  -R $R --reason completed     --comment "$(<$D/done.md)"
gh issue close 50 -R $R --reason 'not planned' --comment "$(<$D/empty.md)"
for n in 4 7 13;      do gh issue close $n -R $R --reason 'not planned' --comment "$(<$D/own.md)"; done
gh issue close 54 -R $R --reason 'not planned' --comment "$(<$D/dup.md)"
```

Don't close Preserve, Phase 3 or Uncertain issues now. They are the Phase 4 re-engagement list:
close each one when 2.0 ships the thing it asks for, linking the commit.

---

## Findings that bear on open tickets

- **016, settings forms: the blank-number trap.** #47 crashed on `float('')`. The obvious Zod fix,
  `z.coerce.number()`, turns `''` into **0**, and a fuzzy ratio of 0 matches every song. That is
  silent data corruption, which is worse than v1's crash. The renderer must turn an empty numeric
  input into `undefined` so that `.default(90)` applies. This belongs in 016's acceptance criteria.
  016's single renderer also resolves #5 (persistent and instance settings rendered by one renderer,
  so enums work in both).
- **015, scheduler.** #12 asks for one automatic retry after a transient failure. Decide whether a
  retry exists and how it interacts with queue depth one. Separately, v1 logged an applet with **no
  trigger** as an ERROR with a traceback (#31's log). An applet that only runs on demand is valid and
  must not log as a failure.
- **011, self-host first run.** Self-hosters really do run Traefik or SWAG in front (#37), including
  under a **URL subpath**. Forwarded-proto/host handling and a base path are first-run concerns
  alongside the trusted-proxy session source. Packaging demand is broad: an Unraid template (#30),
  Yunohost (#41), systemd (#8), and bare-metal **Windows** installs (#29, #65). First run is not
  Docker-only in practice.
- **013, v1 importer.** Real v1 databases contain plugins that v2 will never register: users ran
  Steve-Tech's TIDAL fork into 2023 (PR #45), Captain-Wiggles wrote his own plugins (#30), and 1.2.0
  installs hold both legacy `plex` and `plex beta` applets. The importer needs a defined outcome for
  an applet that references an unknown plugin (skip it and report). Some users also **self-hosted
  `ultrasonics-api`** (#56, PR #45 logs), so `api_url` may hold a private address. Drop it without
  complaint.
- **012, identity collision.** Nothing in the backlog bears on it.
- **ADR-0013 / self-host: more than one connection to the same service.** On PR #45, a user asked to
  sync a *second, separate* Spotify↔Tidal pair in one install. Grants are keyed `(account_id,
  service)`, so one self-host account holds exactly one Spotify grant. A single request, but this is
  a "can't do it at all" gap rather than a rough edge, and the ADR should own it as a known
  limitation. Flag it to Cal, don't act on it.
- **Fog, the conformance test.** #59 is direct evidence for "inputs return a schema-valid song dict":
  v1 shipped an input with the wrong key, and the bug survives on `master`. The SDK proposal enforces
  that return shape "by the handler's type, not a runtime check", which cannot catch bad data from a
  service API (#38's empty title, stripped to absent). Recommend that conformance and the runner
  Zod-parse the song dict at each plugin boundary, and that the song-dict port decides whether
  `title` is `.min(1)`.
- **Fog, notifications. Also the frozen SDK (checkpoint).** Outputs return `void` (plugin-sdk-v2), so
  an output has no structured way to report "matched 0 of 50" or a not-found list. Only log lines
  and throws remain. Users want exactly that report: #30's silent 500s, #32's 1,200 of 10k, and the
  `TIDAL_NOT_FOUND_FILE` that PR #45 users asked for, replaced on each run. Must-still-work #8 cannot
  be fully met without an additive result shape, and adding one is an SDK change.
- **Song dict (ADR-level).** #52 (playlist artwork) and a PR #45 request (keep Spotify's playlist
  **folder** structure) both need fields that `Playlist` lacks. Neither is urgent, but both are
  song-dict changes, so record them before Phase 3 picks up #52.
- **Matcher strategy.** #32 (1,200 of 10k matched, with a request for beets-style manual review) and
  #56 are the backlog's evidence for the `"llm"` matcher seam, or for a review-unmatched UI. The
  roadmap has neither.
