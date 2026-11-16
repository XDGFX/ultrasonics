import { basename, extname } from "node:path";
import {
	type Log,
	normaliseDate,
	normaliseIsrc,
	type SongInput,
	toFileUri,
} from "@ultrasonics/plugin-sdk";
import { type IAudioMetadata, parseFile } from "music-metadata";

/** A trimmed value, or `undefined` for a blank one. */
function text(value: string | undefined): string | undefined {
	return value?.trim() || undefined;
}

/** The file's name without its extension, or the whole name when that leaves nothing. */
export function stemOf(path: string): string {
	const name = basename(path);
	return text(basename(name, extname(name))) ?? name;
}

/**
 * The song a file's tags describe (spec #178, "Tags to a song"). `location` is the path as
 * ultrasonics opened it. A file without a title is carried under its stem, with no artists.
 */
function songFromTags(path: string, metadata: IAudioMetadata): SongInput {
	const { common, format } = metadata;
	const artists = (common.artists ?? (common.artist ? [common.artist] : []))
		.map((artist) => text(artist))
		.filter((artist) => artist !== undefined);
	const rawDate = text(common.date) ?? common.year;
	const isrc = common.isrc?.map(normaliseIsrc).find((value) => value !== undefined);
	const musicbrainz = text(common.musicbrainz_recordingid);
	const durationMs = format.duration ? Math.round(format.duration * 1000) : undefined;
	return {
		title: text(common.title) ?? stemOf(path),
		artists,
		album: text(common.album),
		date: rawDate === undefined ? undefined : normaliseDate(rawDate),
		isrc,
		durationMs: durationMs && durationMs > 0 ? durationMs : undefined,
		location: toFileUri(path),
		id: musicbrainz ? { musicbrainz } : {},
	};
}

/** Reads a file's tags into a song; a file the reader can't parse is carried under its stem. */
export async function readSong(path: string, log: Log): Promise<SongInput> {
	try {
		return songFromTags(path, await parseFile(path, { skipCovers: true }));
	} catch (error) {
		log.debug(`Couldn't read the tags of ${path}, so it goes by its file name: ${String(error)}`);
		return { title: stemOf(path), artists: [], location: toFileUri(path), id: {} };
	}
}
