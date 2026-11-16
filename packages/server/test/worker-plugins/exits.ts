// A fixture plugin loaded by path, as production plugins are, whose input ends its process: in a
// worker that fails one stage, in-process it would stop the server. Code, so it lives outside
// `test/fixtures`, where the type-check would not see it.
import { definePlugin } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** The code the plugin exits with. */
export const EXIT_CODE = 3;

export default definePlugin({
	name: "exits",
	description: "A test fixture",
	version: "1.0.0",
	mode: ["playlists"],
	instanceSettings: { inputs: z.object({}) },
	run: {
		async inputs() {
			return process.exit(EXIT_CODE);
		},
	},
});
