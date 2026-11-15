import { normaliseDate, Song, toFileUri } from "@ultrasonics/plugin-sdk";
import type { PlexTrack } from "./plex-client.ts";

/** The ID space of one Plex server: rating keys mean nothing beyond it (ADR-0023 §2). */
export function idSpace(machineIdentifier: string): string {
	return `plex:${machineIdentifier}`;
}

/** A Plex track as a song dict entry, or `undefined` when it has no title. Plex has no ISRC to give. */
export function toSong(track: PlexTrack, machineIdentifier: string): Song | undefined {
	const artist = track.originalTitle ?? track.grandparentTitle;
	const file = track.Media?.[0]?.Part?.[0]?.file;
	const released = track.originallyAvailableAt ?? track.year ?? track.parentYear;
	const parsed = Song.safeParse({
		title: track.title,
		artists: artist?.trim() ? [artist] : [],
		album: track.parentTitle,
		durationMs: track.duration ? track.duration : undefined,
		date: released === undefined ? undefined : normaliseDate(released),
		location: file === undefined ? undefined : toFileUri(file),
		id: { [idSpace(machineIdentifier)]: track.ratingKey },
	});
	return parsed.data;
}
