import type { SongInput } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/**
 * A track as the three `user.get…Tracks` methods carry it. The artist is `{ name }` in loved and
 * top tracks, `{ "#text" }` in recent ones; only recent tracks have an album, only top tracks a
 * duration. Every field may be missing.
 */
const Track = z.object({
	name: z.string().nullish(),
	artist: z.object({ name: z.string().nullish(), "#text": z.string().nullish() }).nullish(),
	album: z.object({ "#text": z.string().nullish() }).nullish(),
	duration: z.union([z.string(), z.number()]).nullish(),
	"@attr": z.object({ nowplaying: z.string().nullish() }).nullish(),
});

const blankToAbsent = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

/** Whether a recent track is the one playing now, which has not been scrobbled yet. */
export function isNowPlaying(raw: unknown): boolean {
	return Track.safeParse(raw).data?.["@attr"]?.nowplaying === "true";
}

/**
 * One track as a song, or `undefined` when it has no title (spec #185, "Mapping to a `Song`"). It
 * carries no `id`: a Last.fm URL isn't one (ADR-0023 §2), and its `mbid` isn't documented as a
 * recording's.
 */
export function songOf(raw: unknown): SongInput | undefined {
	const track = Track.safeParse(raw).data;
	const title = blankToAbsent(track?.name);
	if (!track || title === undefined) return undefined;
	const artist = blankToAbsent(track.artist?.name ?? track.artist?.["#text"]);
	const song: SongInput = { title, artists: artist === undefined ? [] : [artist] };
	const album = blankToAbsent(track.album?.["#text"]);
	if (album !== undefined) song.album = album;
	const seconds = Number(track.duration);
	if (Number.isInteger(seconds) && seconds > 0) song.durationMs = seconds * 1000;
	return song;
}
