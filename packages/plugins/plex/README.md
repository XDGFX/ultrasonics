# Plex

The `plex` plugin writes playlists to a Plex Media Server. Its contract is spec #114. This file
records the rules a user of the output can see that the settings don't explain.

## The server URL

The server URL may be any `http` or `https` address, including private, loopback and LAN ones,
since a self-hosted Plex usually lives on the LAN (#168). Since it can point at anything, the
client treats what answers as untrusted:

- It reads at most 64 MiB of any response body (`maxResponseBytes`), then fails the request.
- Its error messages give the server URL's origin, the request and the HTTP status, and nothing
  else from the response: an answer that isn't a Plex response gets one message whatever it held,
  and a redirect is refused without naming where it pointed.

The hosted tier must block internal addresses for user-supplied service URLs before it ships
(#135).

## Which Plex playlist a source playlist is written to

The output links each source playlist to the Plex playlist it writes it to, so two source
playlists with the same name never write into the same Plex playlist (#160).

- **The link.** Per applet, the output remembers the source playlist's id and the Plex playlist's
  rating key. It keeps them in `playlist-links/applet-<applet id>.json` in the plugin's config
  directory, one file per applet, written atomically.
- **The source playlist's id** is one entry of its `id` map: the one whose ID space sorts first.
  `{ spotify: "…", deezer: "…" }` is linked by its `deezer` id.
- **A link is followed first.** A source playlist that is linked is written to its Plex playlist
  whatever either is called now, so renaming a source playlist keeps writing to the same Plex
  playlist. The Plex playlist keeps the title it has.
- **A deleted Plex playlist.** If the linked Plex playlist is no longer in Plex, the link is
  dropped and the source playlist is found by name, as below.
- **By name, only without a link.** A source playlist with no link is written to the ordinary
  audio playlist with its exact title, and linked to it. Smart playlists and video or photo
  playlists are never written to. A Plex playlist that is linked to another source playlist of
  the applet, or that this run already wrote to, is never taken by name.
  - No such playlist: a new one is created with the source playlist's name, and linked.
  - Two or more: the source playlist is skipped with the code `ambiguous-playlist`, since the
    output can't tell which one is meant. This happens only when finding by name.
- **Two source playlists with the same name.** If neither is linked, the first takes the Plex
  playlist of that name, if there is one, and the second gets a new playlist, so each is written
  in full. The run log warns that two Plex playlists now share the title. From then on each
  follows its link.
- **Links are kept** while the applet exists, even for a source playlist it no longer sends, so
  that playlist's Plex playlist is never taken by name for another.
- **A source playlist with no id** can't be linked, so it is found by name every run. Two of them
  with the same name each get their own Plex playlist in the first run, and are then skipped as
  `ambiguous-playlist` until one of the Plex playlists is renamed or deleted.
- **An unreadable links file** is started afresh with a warning, and every source playlist is
  found by name that run. A link that can't be saved is warned about; the playlist is still
  written.
