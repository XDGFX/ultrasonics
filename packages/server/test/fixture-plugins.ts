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

/** A run of `held` that has reached its hold: where it was told to keep files, and its release. */
export interface HeldRun {
	configDir: string;
	release(): void;
}

/** Each run of `held` waits here until the test releases it, so a run can be held mid-flight. */
export const holds = (() => {
	const arrived: HeldRun[] = [];
	const waiting: ((run: HeldRun) => void)[] = [];
	return {
		hold(configDir: string): Promise<void> {
			const { promise, resolve } = Promise.withResolvers<void>();
			const run = { configDir, release: resolve };
			const waiter = waiting.shift();
			if (waiter) waiter(run);
			else arrived.push(run);
			return promise;
		},
		/** The next run to reach its hold, in arrival order. */
		next(): Promise<HeldRun> {
			const run = arrived.shift();
			return run ? Promise.resolve(run) : new Promise((resolve) => waiting.push(resolve));
		},
	};
})();

/** An input that logs `lines` lines, then waits on {@link holds} before returning one playlist. */
export const held = definePlugin({
	...handshake,
	name: "held",
	mode: ["playlists"],
	instanceSettings: { inputs: z.object({ lines: z.number().int().min(0).optional() }) },
	run: {
		async inputs(ctx) {
			for (let line = 0; line < (ctx.instance.lines ?? 0); line++) ctx.log.info(`line ${line}`);
			await holds.hold(ctx.configDir);
			return { playlists: [{ name: "Held", songs: [{ title: "Song", artists: ["Artist"] }] }] };
		},
	},
});

/** An output with no service, which accepts every playlist. */
export const sink = definePlugin({
	...handshake,
	name: "sink",
	mode: ["playlists"],
	instanceSettings: { outputs: z.object({}) },
	run: {
		async outputs(ctx) {
			return {
				playlists: ctx.songs.playlists.map((_, playlist) => ({
					status: "written" as const,
					playlist,
					unmatched: [],
				})),
			};
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

export const fixtureRegistry = registryOf(source, plex, plexMixer, spotify, held, sink);
