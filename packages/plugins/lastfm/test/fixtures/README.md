# Last.fm fixtures

**Written by hand, not recorded.** No Last.fm API key existed when the plugin was built (16 November
2026), so every file follows the response shapes on Last.fm's API pages instead of a live answer.
**Re-record them once a key exists**, and correct the plugin and the fake wherever the live API
differs.

Where the shapes come from:

- The method pages ([user.getLovedTracks](https://www.last.fm/api/show/user.getLovedTracks),
  [user.getTopTracks](https://www.last.fm/api/show/user.getTopTracks),
  [user.getRecentTracks](https://www.last.fm/api/show/user.getRecentTracks),
  [chart.getTopArtists](https://www.last.fm/api/show/chart.getTopArtists)) show XML only. The JSON
  here applies the XML→JSON rules on [/api/rest](https://www.last.fm/api/rest): attributes become
  members, an element with text and attributes becomes `{ …, "#text" }`, and every value is a
  string. The list's own attributes sit in `@attr`.
- **Assumed, not documented:** a recent track playing now carries `"@attr": { "nowplaying": "true" }`
  and no `date`, and rides on top of page 1 beyond `limit`; `duration` in top tracks is whole seconds
  as a string, `"0"` when unknown; `mbid` is `""` when missing.
- **Errors** are `{ "error": <number>, "message": "…" }` ([/api/errorcodes](https://www.last.fm/api/errorcodes)).
  A bad key answering `403` with error 10 was seen live without a key. The other statuses the fake
  sends are assumed: `404` for error 6, `403` for 26, `429` for 29, `500` for 8. The plugin branches
  on the `error` code, never the status, except a bare `429`.

| File | Method | Case |
|---|---|---|
| `loved-tracks.json` | `user.getLovedTracks` | Three loved tracks, artist as `{ name }`, one title padded with spaces |
| `top-tracks.json` | `user.getTopTracks` | Three ranked tracks, one with `duration: "0"` |
| `recent-tracks.json` | `user.getRecentTracks` | A now-playing track, a repeat differing only in case, a blank album, a blank title; artist and album as `{ "#text" }` |
| `chart-top-artists.json` | `chart.getTopArtists` | One artist, for `test()` |
| `error-6-user-not-found.json` | any `user.*` | An unknown user |
| `error-10-invalid-key.json` | any | A key Last.fm doesn't know |
| `error-26-suspended-key.json` | any | A suspended key |
| `error-29-rate-limit.json` | any | The rate limit |
| `error-8-operation-failed.json` | any | A temporary backend failure |

The fake in `../fake-lastfm.ts` pages each method's tracks by `limit` and `page` and rewrites `@attr`
to match, so tests can swap in longer lists. It accepts only its own key and knows only the user `rj`.

To re-record, with a key and a username whose history is public:

```sh
curl -A 'ultrasonics/1.0.0' "https://ws.audioscrobbler.com/2.0/?method=user.getLovedTracks&user=<user>&api_key=<key>&format=json&limit=3"
```

and the same for each method above, then scrub the username, and check no file holds the key.
