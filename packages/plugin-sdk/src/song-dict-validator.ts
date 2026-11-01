import { z } from "zod";
import { isRecord } from "./record.ts";
import { Playlist, Song, SongDict, StrictSongDict } from "./song-dict.ts";
import { type IssuePath, issuesOf, type ValidationIssue } from "./validation-issue.ts";

/** A playlist or song the validator dropped, located by position (ADR-0021 §5). */
export interface Rejection {
	playlist: number;
	playlistName?: string;
	/** Present when one song was dropped; absent when the whole playlist was. */
	song?: number;
	songTitle?: string;
	issues: ValidationIssue[];
}

export type SongDictValidation =
	| { ok: true; songDict: SongDict; rejections: Rejection[]; strippedKeys: IssuePath[] }
	| { ok: false; issues: ValidationIssue[] };

const dictKeys = new Set(Object.keys(SongDict.shape));
const playlistKeys = new Set(Object.keys(Playlist.in.shape));
const songKeys = new Set(Object.keys(Song.in.shape));

function unknownKeys(value: unknown, known: Set<string>, path: IssuePath): IssuePath[] {
	return isRecord(value)
		? Object.keys(value)
				.filter((key) => !known.has(key))
				.map((key) => [...path, key])
		: [];
}

/** A label for a rejection, only when the value has a usable one. */
function textField(value: unknown, key: string): string | undefined {
	const field = isRecord(value) ? value[key] : undefined;
	return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

/**
 * Parses what an input or modifier returned (ADR-0021). Leniently, as the runner does, each
 * playlist and song is parsed alone: only what fails is dropped, and unknown keys are stripped and
 * reported. Strictly, as conformance does, any issue at all, repairs included, fails the value.
 */
export function validateSongDict(
	value: unknown,
	options: { strict?: boolean } = {},
): SongDictValidation {
	if (options.strict) {
		const result = StrictSongDict.safeParse(value);
		return result.success
			? { ok: true, songDict: result.data, rejections: [], strippedKeys: [] }
			: { ok: false, issues: issuesOf(result.error, []) };
	}

	const whole = SongDict.extend({ playlists: z.array(z.unknown()) }).safeParse(value);
	if (!whole.success) return { ok: false, issues: issuesOf(whole.error, []) };

	const rejections: Rejection[] = [];
	const strippedKeys = unknownKeys(value, dictKeys, []);
	const playlists: Playlist[] = [];

	for (const [position, raw] of whole.data.playlists.entries()) {
		const path = ["playlists", position];
		const playlistName = textField(raw, "name");
		const named = playlistName === undefined ? {} : { playlistName };
		const rawSongs = isRecord(raw) ? raw.songs : undefined;
		const shell = Playlist.safeParse(
			Array.isArray(rawSongs) && isRecord(raw) ? { ...raw, songs: [] } : raw,
		);
		if (!shell.success) {
			rejections.push({ playlist: position, ...named, issues: issuesOf(shell.error, path) });
			continue;
		}
		strippedKeys.push(...unknownKeys(raw, playlistKeys, path));

		const songs: Song[] = [];
		for (const [songPosition, rawSong] of (rawSongs as unknown[]).entries()) {
			const songPath = [...path, "songs", songPosition];
			const song = Song.safeParse(rawSong);
			if (song.success) {
				songs.push(song.data);
				strippedKeys.push(...unknownKeys(rawSong, songKeys, songPath));
				continue;
			}
			const songTitle = textField(rawSong, "title");
			rejections.push({
				playlist: position,
				...named,
				song: songPosition,
				...(songTitle === undefined ? {} : { songTitle }),
				issues: issuesOf(song.error, songPath),
			});
		}
		playlists.push({ ...shell.data, songs });
	}

	return { ok: true, songDict: { ...whole.data, playlists }, rejections, strippedKeys };
}
