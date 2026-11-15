# Plex fixtures

**Written by hand, not recorded.** No Plex Media Server was available when the plugin was built, so
these responses were written from the Plex HTTP API as python-plexapi drives it (`plexapi/server.py`,
`library.py`, `playlist.py`, `audio.py`) and Plex's published API reference. They must be
re-recorded against a real server once the Plex test server (#116) exists, with the token scrubbed.

The fake server in `../fake-plex.ts` serves them. Each file is one endpoint's JSON response
(`Accept: application/json`):

| File | Endpoint | Case |
|---|---|---|
| `server-root.json` | `GET /` | The server's identity: `machineIdentifier`, `friendlyName` |
| `library-sections.json` | `GET /library/sections` | One music library (`type: "artist"`) and one film library |
| `library-sections-two-music.json` | `GET /library/sections` | Two music libraries, so a blank `library` is ambiguous |
| `library-section-tracks.json` | `GET /library/sections/1/all?type=10` | Every track in the music library. The fake answers a `title` search and `GET /library/metadata/<ratingKey>` from it |
| `playlists.json` | `GET /playlists` | An ordinary audio playlist, smart and video playlists sharing a title, two ordinary playlists sharing a title, a photo playlist |
| `playlist-items.json` | `GET /playlists/7001/items` | The items of `Focus`, each with its `playlistItemID` |
| `playlist-created.json` | `POST /playlists?uri=…&type=audio&title=…&smart=0` | The playlist Plex created |
| `playlist-items-added.json` | `PUT /playlists/<ratingKey>/items?uri=…` | Plex's answer to an add |
| `unauthorised.html` | any, with a refused token | Plex's 401 body, which is HTML whatever `Accept` asked for |

Tracks are addressed in writes as
`server://<machineIdentifier>/com.plexapp.plugins.library/library/metadata/<ratingKey>,<ratingKey>…`.
