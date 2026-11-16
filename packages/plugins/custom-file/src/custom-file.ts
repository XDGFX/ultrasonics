import { definePlugin } from "@ultrasonics/plugin-sdk";
import { outputSettings } from "./output-settings.ts";
import { writePlaylists } from "./playlist-output.ts";

/**
 * Writes each playlist as a text file, one line per song from the user's pattern (spec #180). No
 * auth, no persistent settings and no `test()`: there is nothing to check before a run.
 */
export default definePlugin({
	name: "custom-file",
	description: "Writes playlists to text files, one line per song from your own pattern",
	version: "1.0.0",
	mode: ["playlists"],
	instanceSettings: { outputs: outputSettings },
	run: {
		outputs: (ctx) => writePlaylists(ctx.songs, ctx.instance, ctx.log),
	},
});
