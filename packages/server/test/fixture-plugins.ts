// Fixture plugins for the server's tests, written as a plugin author would. Code, so it lives outside
// `test/fixtures`, where the type-check would not see it.
import {
	defineAuth,
	definePlugin,
	type Plugin,
	type PluginRegistry,
} from "@ultrasonics/plugin-sdk";
import { z } from "zod";

const handshake = { description: "A test fixture", version: "1.0.0" } as const;

/** The token a fixture `plex` test accepts; any other well-formed token fails its test. */
export const GOOD_TOKEN = "good-token";
/** The token that makes the fixture `plex` test throw, as a broken plugin would. */
export const THROWING_TOKEN = "throw";

const plexAuth = defineAuth({
	service: "plex",
	flow: "token",
	fields: z.object({ url: z.string().min(1), token: z.string().min(1) }),
});

export const source = definePlugin({
	...handshake,
	name: "source",
	mode: ["playlists"],
	persistentSettings: z.object({ region: z.enum(["au", "gb"]) }),
	instanceSettings: { inputs: z.object({ playlist: z.string().min(1) }) },
	run: {
		async inputs() {
			return { playlists: [] };
		},
	},
});

export const plex = definePlugin({
	...handshake,
	name: "plex",
	mode: ["playlists"],
	auth: plexAuth,
	persistentSettings: z.object({ library: z.string().min(1) }),
	instanceSettings: { outputs: z.object({ playlistPrefix: z.string().optional() }) },
	run: {
		async outputs() {
			return { playlists: [] };
		},
	},
	async test(ctx) {
		const { token } = await ctx.auth.get();
		if (token === THROWING_TOKEN) throw new Error("the fixture's test is broken");
		return token === GOOD_TOKEN
			? { ok: true }
			: { ok: false, code: "invalid-credentials", message: `Plex refused the token ${token}` };
	},
});

/** A second plugin on the plex service, with the same spec, sharing one grant (ADR-0013 §2). */
export const plexMixer = definePlugin({
	...handshake,
	name: "plex-mixer",
	mode: ["playlists"],
	auth: plexAuth,
	instanceSettings: { modifiers: z.object({}) },
	run: {
		async modifiers(ctx) {
			return ctx.songs;
		},
	},
});

export const spotify = definePlugin({
	...handshake,
	name: "spotify",
	mode: ["playlists"],
	auth: defineAuth({ service: "spotify", flow: "oauth2-pkce", scopes: ["playlist-read-private"] }),
	instanceSettings: { inputs: z.object({}) },
	run: {
		async inputs() {
			return { playlists: [] };
		},
	},
});

/** A registry entry for each plugin, by name. */
export function registryOf(...plugins: Plugin[]): PluginRegistry {
	return Object.fromEntries(
		plugins.map((plugin) => [
			plugin.name,
			{ path: `test/${plugin.name}`, load: async () => ({ default: plugin }) },
		]),
	);
}

export const fixtureRegistry = registryOf(source, plex, plexMixer, spotify);
