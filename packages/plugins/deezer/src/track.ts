import { normaliseIsrc, type SongInput } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A track as the playlist tracks list carries it; every field may be missing. */
const Track = z.object({
	id: z.union([z.number(), z.string()]).nullish(),
	title: z.string().nullish(),
	isrc: z.string().nullish(),
	duration: z.number().nullish(),
	explicit_lyrics: z.boolean().nullish(),
	artist: z.object({ name: z.string().nullish() }).nullish(),
	album: z.object({ title: z.string().nullish() }).nullish(),
});

export const blankToAbsent = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

/**
 * One track as a song, or `undefined` when it has no title (spec #184, "Mapping a track"). Blank
 * optional fields are left out rather than sent empty (ADR-0023). `readable: false` tracks are
 * carried: the song exists.
 */
export function songOf(raw: unknown): SongInput | undefined {
	const track = Track.safeParse(raw).data;
	const title = blankToAbsent(track?.title);
	if (!track || title === undefined) return undefined;
	const artist = blankToAbsent(track.artist?.name);
	const song: SongInput = { title, artists: artist === undefined ? [] : [artist] };
	const album = blankToAbsent(track.album?.title);
	if (album !== undefined) song.album = album;
	const rawIsrc = blankToAbsent(track.isrc);
	const isrc = rawIsrc === undefined ? undefined : normaliseIsrc(rawIsrc);
	if (isrc !== undefined) song.isrc = isrc;
	const { duration } = track;
	if (typeof duration === "number" && Number.isInteger(duration) && duration > 0) {
		song.durationMs = duration * 1000;
	}
	if (typeof track.explicit_lyrics === "boolean") song.explicit = track.explicit_lyrics;
	const id = blankToAbsent(
		track.id === null || track.id === undefined ? undefined : String(track.id),
	);
	if (id !== undefined) song.id = { deezer: id };
	return song;
}
