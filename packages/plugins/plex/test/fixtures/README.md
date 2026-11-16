# Plex fixtures

**Recorded from a real Plex Media Server**, version `1.43.5.11079-b3b13e506` (the
`plexinc/pms-docker` image), on 2026-11-16: the Plex test server of #116. Its "Music" library holds
20 Kevin MacLeod tracks (CC BY 4.0), "Music 2" holds 3. Every file is the server's JSON answer
(`Accept: application/json`), pretty-printed, with these changes:

- **Scrubbed.** `server-root.json`'s `machineIdentifier` is `scrubbed-machine-identifier`, its
  `myPlexUsername` is a placeholder address, `ownerFeatures` is `scrubbed` and `friendlyName` is
  `plex-test`. The token never appears: Plex doesn't echo it.
- **`library-sections.json`** is `library-sections-two-music.json` with "Music 2" removed, so it
  shows one music library beside a film library.
- **`playlists.json`** was recorded with two extra playlists made for it ("Twice" twice, a smart
  "Smart only") and has one entry added by hand: the video playlist `51`, "Smart only", cloned from
  the smart one. The test server has no video library to make a real one in.

The fake server in `../fake-plex.ts` serves them:

| File | Endpoint | Case |
|---|---|---|
| `server-root.json` | `GET /` | The server's identity: `machineIdentifier`, `version` |
| `library-sections.json` | `GET /library/sections` | One music library (`type: "artist"`) and one film library |
| `library-sections-two-music.json` | `GET /library/sections` | Two music libraries, so a blank `library` is ambiguous |
| `library-section-tracks.json` | `GET /library/sections/1/all?type=10` | Every track in "Music". The fake answers a `title` search and `GET /library/metadata/<ratingKey>` from it |
| `library-metadata.json` | `GET /library/metadata/25` | One track. Unlike a section listing, it names `librarySectionID` on the item |
| `playlists.json` | `GET /playlists` | An ordinary and a smart audio playlist sharing a title, two ordinary playlists sharing a title, a smart and a video playlist sharing a title |
| `playlist-items.json` | `GET /playlists/44/items` | The ordinary playlist's items, each with its `playlistItemID` |
| `playlist-created.json` | `POST /playlists?uri=…&type=audio&title=…&smart=0` | The playlist Plex created. It carries no `leafCountAdded`, even when Plex dropped a repeat. The fake answers every create from it, rekeyed and retitled |
| `playlist-items-added.json` | `PUT /playlists/<ratingKey>/items?uri=…` | Plex's answer to an add of two tracks, one already held. The fake answers every add from it with the counts it actually added |
| `unauthorised.html` | any, with no token | Plex's 401 body, which is HTML whatever `Accept` asked for |

What the recording showed, and the fake reproduces:

- A section listing names `librarySectionID` once, on the `MediaContainer`, not on each track.
  `/library/metadata/<ratingKey>` names it on the item, as a number, beside `type: "track"`.
- `smart` is a JSON boolean.
- Plex won't add a track a playlist already holds: an add answers `leafCountAdded` below
  `leafCountRequested`, both with a 200, and a create drops repeated rating keys silently. The
  fake's playlist `44`, and each playlist it creates (from key `1000`), is live and does the same.
- `GET /playlists/<ratingKey>/items` with no paging headers returned every item, with no
  `totalSize`. `X-Plex-Container-Start`/`-Size` page it and add `totalSize`. The server held too few
  tracks to show whether an unpaged answer is ever cut short.
- `PUT /playlists/<ratingKey>/items/<playlistItemID>/move?after=<playlistItemID>` moves an item; no
  `after` moves it to the top.
- The `title` filter matches each query word as the start of a title word, words split on spaces:
  `Miri Magic` finds `Miri’s Magic Dance`, but `agic` and `s Magic Dance` don't. It ignores case
  and accents (`Antigua` finds `Antígua`) but not quotes (`Miri's` doesn't find `Miri’s`). The
  fake searches the same way.

Tracks are addressed in writes as
`server://<machineIdentifier>/com.plexapp.plugins.library/library/metadata/<ratingKey>,<ratingKey>…`.

To re-record, point `curl -H "X-Plex-Token: …" -H 'Accept: application/json'` at the test server
for each endpoint above, then scrub `server-root.json` as listed.
