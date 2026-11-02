# Licence of the match dataset

`musicbrainz.json` is derived from MusicBrainz core data, which the MetaBrainz Foundation
releases into the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). It holds only core fields: recording
and track titles, artist credits, lengths, ISRCs, release titles and dates, and recording MBIDs.
No tags, ratings or annotations, which are CC BY-NC-SA, are included.
`scripts/build-cc0-tier.ts` regenerates it.

`hand-written.json` was written by the project's contributors, with no data copied from any
service, and is under the repository's licence.

`spot-check.json` records the hand spot-check of the MusicBrainz cases; the builder leaves out
every case it marks bad.

Nothing from Spotify, Deezer or any other service is committed here. The service tier stays in the
git-ignored `service-tier-cache/`.
