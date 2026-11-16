# Local playlists fixtures

Tests copy this folder into a temporary one, so `../music/…` entries resolve and nothing outside
it is read. `music/Fête.mp3` is made there from `untagged.mp3`, so no committed name depends on how
git stores Unicode.

## `music/`

Generated on 2026-11-16 from silence (`anullsrc`, 8 kHz mono, 0.2 s) with the `linuxserver/ffmpeg`
image. No recorded audio, so no licence applies.

| File | Tags |
|---|---|
| `tagged.mp3` | ID3v2.4: title, artist, album, date `2021-03-04`, ISRC `GB-AAA-21-00001` (hyphenated, to be normalised). No Xing header, so no duration |
| `tagged.m4a` | AAC in MP4: title, artist, album, date `2020`. Duration 328 ms, with the encoder's priming |
| `tagged.flac` | Vorbis comments: `ARTIST` `Ada Lovelace; Grace Hopper` beside a multi-value `ARTISTS` `Ada Lovelace`, date `2019-11`, ISRC, `MUSICBRAINZ_TRACKID`. Duration 200 ms |
| `untagged.mp3` | None |

```sh
docker run --rm -v "$PWD/music:/out" --entrypoint sh linuxserver/ffmpeg -c '
S="-f lavfi -i anullsrc=r=8000:cl=mono -t 0.2"
ffmpeg $S -c:a libmp3lame -b:a 8k -id3v2_version 4 -write_xing 0 -metadata title="Quiet Room" \
  -metadata artist="Ada Lovelace" -metadata album="Silence Sessions" -metadata date="2021-03-04" \
  -metadata TSRC="GB-AAA-21-00001" /out/tagged.mp3
ffmpeg $S -c:a aac -b:a 8k -metadata title="Empty Hall" -metadata artist="Grace Hopper" \
  -metadata album="Silence Sessions" -metadata date="2020" /out/tagged.m4a
ffmpeg $S -c:a flac -metadata TITLE="Still Air" -metadata ARTIST="Ada Lovelace; Grace Hopper" \
  -metadata ARTISTS="Ada Lovelace" -metadata album="Silence Sessions" -metadata DATE="2019-11" \
  -metadata ISRC="USAAA1900002" -metadata MUSICBRAINZ_TRACKID="8f3471b5-7e6a-48da-86a9-c1c07a0f47ae" \
  /out/tagged.flac
ffmpeg $S -c:a libmp3lame -b:a 8k -map_metadata -1 -write_id3v2 0 -write_xing 0 /out/untagged.mp3'
```

## `playlists/`

Written by hand with `printf`, byte for byte.

| File | Case |
|---|---|
| `relative.m3u8` | UTF-8 with a BOM, `#EXTM3U` and `#EXTINF` lines, a blank line, relative entries, an `https` stream, a missing file, a repeated entry and the untagged file |
| `latin-1.m3u` | Windows-1252: `../music/F\xEAte.mp3`, which isn't valid UTF-8 |
| `windows.m3u` | CRLF endings, a drive path `D:\Music\tagged.flac` and `file:///D:/Music/tagged.mp3`. Resolves only with the mapping `D:\Music` to the temporary `music/`; without it, every entry is missing |
| `Rock/Classics.M3U` | An upper-case extension in a subfolder, read only when `recursive` is set |
| `._relative.m3u8` | A macOS AppleDouble file, binary junk, which must be skipped as hidden |
| `.hidden.m3u` | A hidden playlist, skipped |
| `notes.txt` | Not a playlist, ignored |
