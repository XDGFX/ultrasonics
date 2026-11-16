import { defineAuth, definePlugin, type Log, type TestResult } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { inputSettings } from "./input-settings.ts";
import { readPlaylists } from "./playlist-input.ts";
import { SpotifyClient, SpotifyError } from "./spotify-client.ts";

export interface SpotifyPluginOptions {
	/** The Web API base: `https://api.spotify.com/v1`, or a fake's in tests. */
	apiBase: string;
	/** How a rate-limit wait is spent; tests pass one that returns at once. */
	sleep?: (ms: number) => Promise<void>;
}

/** Read access to the user's playlists and Liked Songs, and nothing else (spec #136, decision 5). */
export const scopes = [
	"playlist-read-private",
	"playlist-read-collaborative",
	"user-library-read",
] as const;

const notOnUserList =
	"This Spotify account isn't on your app's user list. Development mode allows five users, added under User Management.";

/** The Spotify plugin against one Web API, so tests can point it at a fake (spec #136). */
export function createSpotifyPlugin(options: SpotifyPluginOptions) {
	const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
	const clientFor = (auth: { get(): Promise<{ accessToken: string }> }, log: Log) =>
		new SpotifyClient({
			apiBase: options.apiBase,
			accessToken: async () => (await auth.get()).accessToken,
			log,
			sleep,
		});

	return definePlugin({
		name: "spotify",
		description: "Reads playlists and liked songs from your Spotify account",
		version: "1.0.0",
		mode: ["playlists"],
		auth: defineAuth({ service: "spotify", flow: "oauth2-pkce", scopes }),
		instanceSettings: { inputs: inputSettings },
		run: {
			async inputs(ctx) {
				return readPlaylists(clientFor(ctx.auth, ctx.log), ctx.instance, ctx.log);
			},
		},
		async test(ctx): Promise<TestResult> {
			try {
				await clientFor(ctx.auth, ctx.log).get(z.unknown(), "/me");
				return { ok: true };
			} catch (error) {
				if (!(error instanceof SpotifyError)) throw error;
				if (error.code === "invalid-credentials") {
					return { ok: false, code: "invalid-credentials", message: error.message };
				}
				if (error.code === "unreachable") {
					return { ok: false, code: "unreachable", message: error.message };
				}
				const message = error.status === 403 ? notOnUserList : error.message;
				return { ok: false, code: "misconfigured", message };
			}
		},
	});
}
