# Local music database fixtures

Tests copy `music/` into a temporary folder, so the index and any file a test touches, deletes or
hides stay out of the repo.

## `music/`

Generated on 2026-11-16 from silence (`anullsrc`, 8 kHz mono, 0.2 s) with the `linuxserver/ffmpeg`
image, in the local playlists fixtures' way. No recorded audio, so no licence applies.

| File | Tags | Case |
|---|---|---|
| `Ada Lovelace/Live at the Hall/Quiet Room.mp3` | title, artist, album `Live at the Hall`, date `2023-05-01` | The live version, which sorts first |
| `Ada Lovelace/Silence Sessions/Quiet Room.mp3` | the same title and artist, album `Silence Sessions`, date `2021-03-04`, ISRC `GB-AAA-21-00001` | The studio version, which the matcher prefers; the ISRC case |
| `Grace Hopper/Still Air.flac` | Vorbis comments: title, artist, album, date `2019-11`, `MUSICBRAINZ_TRACKID` | The MusicBrainz id case |
| `Grace Hopper/Night Drive.m4a` | AAC in MP4: title, artist, album, date `2020` | The cut-title fallback |

```sh
docker run --rm -v "$PWD/music:/out" --entrypoint sh linuxserver/ffmpeg -c '
S="-f lavfi -i anullsrc=r=8000:cl=mono -t 0.2"
M="-c:a libmp3lame -b:a 8k -id3v2_version 4 -write_xing 0"
mkdir -p "/out/Ada Lovelace/Live at the Hall" "/out/Ada Lovelace/Silence Sessions" "/out/Grace Hopper"
ffmpeg $S $M -metadata title="Quiet Room" -metadata artist="Ada Lovelace" \
  -metadata album="Live at the Hall" -metadata date="2023-05-01" \
  "/out/Ada Lovelace/Live at the Hall/Quiet Room.mp3"
ffmpeg $S $M -metadata title="Quiet Room" -metadata artist="Ada Lovelace" \
  -metadata album="Silence Sessions" -metadata date="2021-03-04" -metadata TSRC="GB-AAA-21-00001" \
  "/out/Ada Lovelace/Silence Sessions/Quiet Room.mp3"
ffmpeg $S -c:a flac -metadata TITLE="Still Air" -metadata ARTIST="Grace Hopper" \
  -metadata album="Silence Sessions" -metadata DATE="2019-11" \
  -metadata MUSICBRAINZ_TRACKID="8f3471b5-7e6a-48da-86a9-c1c07a0f47ae" "/out/Grace Hopper/Still Air.flac"
ffmpeg $S -c:a aac -b:a 8k -metadata title="Night Drive" -metadata artist="Grace Hopper" \
  -metadata album="Silence Sessions" -metadata date="2020" "/out/Grace Hopper/Night Drive.m4a"'
```
