import { definePlugin } from "@ultrasonics/plugin-sdk";
import { DeezerClient } from "./deezer-client.ts";
import { inputSettings } from "./input-settings.ts";
import { readPlaylists } from "./playlist-input.ts";

export interface DeezerPluginOptions {
	/** The API base: `https://api.deezer.com`, or a fake's in tests. */
	apiBase: string;
	/** How a quota wait is spent; tests pass one that returns at once. */
	sleep?: (ms: number) => Promise<void>;
}

/**
 * The Deezer plugin against one API, so tests can point it at a fake (spec #184). It reads public
 * playlists only, with no auth: Deezer no longer registers the apps anything else needs.
 */
export function createDeezerPlugin(options: DeezerPluginOptions) {
	const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
	return definePlugin({
		name: "deezer",
		description: "Reads public Deezer playlists by link",
		version: "1.0.0",
		mode: ["playlists"],
		instanceSettings: { inputs: inputSettings },
		run: {
			async inputs(ctx) {
				const client = new DeezerClient({ apiBase: options.apiBase, log: ctx.log, sleep });
				return readPlaylists(client, ctx.instance, ctx.log);
			},
		},
	});
}
