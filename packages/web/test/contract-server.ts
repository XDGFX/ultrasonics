// The real server for the HTTP client's contract test, booted in-process on a free port with fixture
// plugins written as a plugin author would. Code, so it lives outside `test/fixtures`.
import { afterAll, afterEach, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// biome-ignore lint/style/noRestrictedImports: the contract test boots the real server; no screen imports it, so it never reaches the bundle.
import { InProcessExecutor } from "@ultrasonics/core";
import {
	defineAuth,
	definePlugin,
	type Plugin,
	type PluginRegistry,
} from "@ultrasonics/plugin-sdk";
// biome-ignore lint/style/noRestrictedImports: the contract test boots the real server; no screen imports it, so it never reaches the bundle.
import { boot } from "@ultrasonics/server";
import { z } from "zod";

const handshake = { description: "A contract fixture", version: "1.0.0" } as const;

/** The region the fixture `source` check accepts; any other fails it. */
export const CHECKED_REGION = "au";

/** The token the fixture `plex` test accepts; any other fails it. */
export const GOOD_TOKEN = "good-token";

const songs = z.object({ count: z.number().int().min(1) });

export const source = definePlugin({
	...handshake,
	name: "source",
	mode: ["playlists"],
	persistentSettings: z.object({ region: z.enum(["au", "gb"]) }),
	instanceSettings: { inputs: songs },
	run: {
		async inputs(ctx) {
			ctx.log.info("reading");
			const playlist = Array.from({ length: ctx.instance.count }, (_, n) => ({
				title: `Song ${n + 1}`,
				artists: ["Artist"],
			}));
			return { playlists: [{ name: "Mix", songs: playlist }] };
		},
	},
	async test(ctx) {
		return ctx.persistent.region === CHECKED_REGION
			? { ok: true }
			: { ok: false, code: "unreachable", message: "No catalogue in that region" };
	},
});

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

export const plex = definePlugin({
	...handshake,
	name: "plex",
	mode: ["playlists"],
	auth: defineAuth({
		service: "plex",
		flow: "token",
		fields: z.object({ url: z.string().min(1), token: z.string().min(1) }),
	}),
	instanceSettings: { outputs: z.object({}) },
	run: {
		async outputs() {
			return { playlists: [] };
		},
	},
	async test(ctx) {
		const { token } = await ctx.auth.get();
		return token === GOOD_TOKEN
			? { ok: true }
			: { ok: false, code: "invalid-credentials", message: "Plex refused the token" };
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

function registryOf(...plugins: Plugin[]): PluginRegistry {
	return Object.fromEntries(
		plugins.map((plugin) => [
			plugin.name,
			{ path: `test/${plugin.name}`, load: async () => ({ default: plugin }) },
		]),
	);
}

const silent = { info() {}, warn() {}, error() {} };

/**
 * Boots the server for each test that asks, on a fresh data directory, and stops it afterwards, with
 * an `EventSource` to read its run streams. happy-dom's globals stand down meanwhile: `Bun.serve`
 * accepts only Bun's own `Response`.
 */
export function useContractServer(): () => Promise<{
	origin: string;
	EventSource: typeof import("eventsource").EventSource;
}> {
	beforeAll(() => GlobalRegistrator.unregister());
	afterAll(() => GlobalRegistrator.register());
	const running: { stop(): Promise<void>; dir: string }[] = [];
	afterEach(async () => {
		for (const { stop, dir } of running.splice(0)) {
			await stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});
	return async () => {
		const dir = mkdtempSync(join(tmpdir(), "ultrasonics-contract-"));
		const result = await boot({
			env: {
				ENCRYPTION_KEY: "0".repeat(64),
				AUTH_SOURCE: "bootstrapped",
				DATA_DIR: dir,
				PORT: "0",
			},
			registry: registryOf(source, sink, plex, spotify),
			// The fixtures' paths are made up, so they run in-process rather than in workers.
			executor: new InProcessExecutor(),
			logger: silent,
			webRoot: join(dir, "no-web-root"),
		});
		if (!result.ok) throw new Error(JSON.stringify(result.problems));
		running.push({ stop: result.stop, dir });
		// Imported only now, so its events extend Bun's `Event` rather than happy-dom's.
		const { EventSource } = await import("eventsource");
		return { origin: result.server.url.origin, EventSource };
	};
}
