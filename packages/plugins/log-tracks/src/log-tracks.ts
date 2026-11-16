import {
	definePlugin,
	type Log,
	type OutputResult,
	type Song,
	type SongDict,
} from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** Song lines per run, so a large playlist never pushes a run's errors out of its capped log. */
export const SONG_LINE_CAP = 500;

/** `<position>. <artists> - <title> [<album>] <space>:<id> … isrc:<isrc> <location>`, absent fields left out. */
function songLine(position: number, song: Song): string {
	const named = song.artists.length > 0 ? `${song.artists.join(", ")} - ${song.title}` : song.title;
	return [
		`${position}. ${named}`,
		song.album === undefined ? undefined : `[${song.album}]`,
		...Object.entries(song.id).map(([space, id]) => `${space}:${id}`),
		song.isrc === undefined ? undefined : `isrc:${song.isrc}`,
		song.location,
	]
		.filter((part) => part !== undefined)
		.join(" ");
}

/** Logs every playlist's songs, writing nothing, so an applet can be checked as a dry run. */
function logSongs(songs: SongDict, log: Log): OutputResult {
	let remaining = SONG_LINE_CAP;
	let omitted = 0;
	const playlists = songs.playlists.map((playlist, index): OutputResult["playlists"][number] => {
		if (playlist.songs.length === 0) {
			return { status: "skipped", playlist: index, code: "empty", message: "No songs to log" };
		}
		log.info(`"${playlist.name}": ${playlist.songs.length} songs`);
		const shown = playlist.songs.slice(0, remaining);
		for (const [position, song] of shown.entries()) log.info(songLine(position + 1, song));
		remaining -= shown.length;
		omitted += playlist.songs.length - shown.length;
		return { status: "written", playlist: index, unmatched: [] };
	});
	if (omitted > 0) log.info(`${omitted} song lines omitted`);
	return { playlists };
}

export default definePlugin({
	name: "log-tracks",
	description: "Logs each playlist's songs and writes nothing, for a dry run",
	version: "1.0.0",
	mode: ["playlists"],
	instanceSettings: { outputs: z.object({}) },
	run: {
		async outputs(ctx) {
			return logSongs(ctx.songs, ctx.log);
		},
	},
});
