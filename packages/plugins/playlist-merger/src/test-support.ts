import type { LogLevel, PlaylistInput, SongDictInput } from "@ultrasonics/plugin-sdk";
import { SongDict } from "@ultrasonics/plugin-sdk";
import playlistMerger from "./index.ts";

/** Runs the `modifiers` handler on `playlists`, recording what it logs. */
export async function merge(...playlists: PlaylistInput[]) {
	const lines: { level: LogLevel; message: string }[] = [];
	const to = (level: LogLevel) => (message: string) => {
		lines.push({ level, message });
	};
	const log = { debug: to("debug"), info: to("info"), warn: to("warn"), error: to("error") };
	const out: SongDictInput = await playlistMerger.run.modifiers({
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: "/config",
		persistent: {},
		instance: {},
		log,
		songs: SongDict.parse({ playlists }),
	});
	return { playlists: SongDict.parse(out).playlists, lines };
}
