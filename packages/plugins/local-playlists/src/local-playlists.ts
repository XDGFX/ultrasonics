import { definePlugin } from "@ultrasonics/plugin-sdk";
import { inputSettings } from "./input-settings.ts";
import { pathMapping } from "./path-mapping.ts";
import { readPlaylists } from "./playlist-input.ts";

/**
 * Playlists as `.m3u` and `.m3u8` files in a folder (spec #178). No auth: there is no service, and
 * no `test()`, since the folders are instance settings a test never sees.
 */
export const localPlaylists = definePlugin({
	name: "local-playlists",
	description: "Reads playlists from .m3u and .m3u8 files in a folder",
	version: "1.0.0",
	mode: ["playlists"],
	persistentSettings: pathMapping,
	instanceSettings: { inputs: inputSettings },
	run: {
		async inputs(ctx) {
			return readPlaylists(ctx.instance, ctx.persistent, ctx.log);
		},
	},
});
