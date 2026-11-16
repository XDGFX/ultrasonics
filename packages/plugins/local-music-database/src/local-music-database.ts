import { definePlugin, type TestResult } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { LibraryIndex } from "./library-index.ts";
import { locateSongs } from "./locate.ts";
import { musicFolderProblem, musicSettings } from "./music-folder.ts";
import { scanMusicFolder } from "./scan.ts";

/**
 * Finds each song's file in the account's music folder (spec #179). No auth: there is no service.
 * `test()` checks the music folder, which is the whole of its configuration.
 */
export const localMusicDatabase = definePlugin({
	name: "local-music-database",
	description: "Finds each song's file in your music folder",
	version: "1.0.0",
	mode: ["playlists"],
	persistentSettings: musicSettings,
	instanceSettings: { modifiers: z.object({}) },
	run: {
		async modifiers(ctx) {
			const { musicDir } = ctx.persistent;
			const problem = await musicFolderProblem(musicDir);
			if (problem !== undefined) throw new Error(problem);
			const index = LibraryIndex.open(ctx.configDir, musicDir, ctx.log);
			try {
				await scanMusicFolder(index, musicDir, ctx.log);
				return locateSongs(ctx.songs.playlists, index, ctx.log);
			} finally {
				index.close();
			}
		},
	},
	async test(ctx): Promise<TestResult> {
		const problem = await musicFolderProblem(ctx.persistent.musicDir);
		return problem === undefined
			? { ok: true }
			: { ok: false, code: "misconfigured", message: problem };
	},
});
