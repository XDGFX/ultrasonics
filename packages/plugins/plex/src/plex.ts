import { defineAuth, definePlugin, type TestResult } from "@ultrasonics/plugin-sdk";
import { inputSettings, readPlaylists } from "./playlist-input.ts";
import { outputSettings, writePlaylists } from "./playlist-output.ts";
import { grantFields, PlexClient, PlexError } from "./plex-client.ts";

export const plex = definePlugin({
	name: "plex",
	description: "Reads and writes playlists on a Plex Media Server",
	version: "1.0.0",
	mode: ["playlists"],
	auth: defineAuth({ service: "plex", flow: "token", fields: grantFields }),
	instanceSettings: { inputs: inputSettings, outputs: outputSettings },
	run: {
		async inputs(ctx) {
			return readPlaylists(await ctx.auth.get(), ctx.instance, ctx.log);
		},
		async outputs(ctx) {
			const grant = await ctx.auth.get();
			return writePlaylists(grant, ctx.instance, ctx.songs.playlists, ctx.log, ctx);
		},
	},
	async test(ctx): Promise<TestResult> {
		try {
			await PlexClient.connect(await ctx.auth.get());
			return { ok: true };
		} catch (error) {
			if (!(error instanceof PlexError)) throw error;
			// Unlike a run, `test()` reads a 403 as the token too: it asks only who the server is.
			if (error.code === "invalid-credentials" || error.status === 403) {
				return { ok: false, code: "invalid-credentials", message: error.message };
			}
			const code = error.code === "unreachable" ? "unreachable" : "misconfigured";
			return { ok: false, code, message: error.message };
		}
	},
});
