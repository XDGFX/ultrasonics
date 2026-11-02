// Fixture plugins for the runner's tests, written as a plugin author would. Code, so it lives outside
// `test/fixtures`, where the type-check would not see it.
import {
	defineAuth,
	definePlugin,
	type OutputResult,
	type PluginRegistry,
	type SongDict,
} from "@ultrasonics/plugin-sdk";
import { z } from "zod";

const handshake = { description: "A test fixture", version: "1.0.0" } as const;

/** Every playlist written, with the given positions unmatched in each. */
function writtenAll(songs: SongDict, unmatched: number[] = []): OutputResult {
	return {
		playlists: songs.playlists.map((_, playlist) => ({ status: "written", playlist, unmatched })),
	};
}

/**
 * A fresh set of fixture plugins, recording which handlers ran and what each output received.
 * Settings make each fixture's behaviour explicit at the call site.
 */
export function fixturePlugins() {
	const calls: string[] = [];
	const received: Record<string, SongDict[]> = {};
	const receive = (name: string, songs: SongDict) => {
		received[name] = [...(received[name] ?? []), structuredClone(songs)];
	};

	const plugins = {
		/** Returns its `returns` setting verbatim, so a test can hand back anything. */
		echo: definePlugin({
			...handshake,
			name: "echo",
			mode: ["playlists"],
			instanceSettings: { inputs: z.object({ returns: z.unknown() }) },
			run: {
				async inputs(ctx) {
					calls.push("echo");
					ctx.log.info("echoing");
					// The point of the fixture is to return what the test chose, valid or not.
					return ctx.instance.returns as SongDict;
				},
			},
		}),
		suffix: definePlugin({
			...handshake,
			name: "suffix",
			mode: ["playlists"],
			instanceSettings: { modifiers: z.object({ suffix: z.string() }) },
			run: {
				async modifiers(ctx) {
					calls.push("suffix");
					return {
						playlists: ctx.songs.playlists.map((p) => ({
							...p,
							name: p.name + ctx.instance.suffix,
						})),
					};
				},
			},
		}),
		/** Writes every playlist, leaving the `unmatched` positions unmatched. */
		writer: definePlugin({
			...handshake,
			name: "writer",
			mode: ["playlists"],
			instanceSettings: {
				outputs: z.object({ unmatched: z.array(z.number()).default([]) }),
			},
			run: {
				async outputs(ctx) {
					calls.push("writer");
					receive("writer", ctx.songs);
					return writtenAll(ctx.songs, ctx.instance.unmatched);
				},
			},
		}),
		/** Writes, but empties what it was given first. */
		vandal: definePlugin({
			...handshake,
			name: "vandal",
			mode: ["playlists"],
			instanceSettings: { outputs: z.object({}) },
			run: {
				async outputs(ctx) {
					calls.push("vandal");
					const result = writtenAll(ctx.songs);
					for (const playlist of ctx.songs.playlists) playlist.songs.length = 0;
					ctx.songs.playlists.length = 0;
					return result;
				},
			},
		}),
		/** The service refuses every write. */
		refused: definePlugin({
			...handshake,
			name: "refused",
			mode: ["playlists"],
			instanceSettings: { outputs: z.object({}) },
			run: {
				async outputs(ctx) {
					calls.push("refused");
					return {
						playlists: ctx.songs.playlists.map((_, playlist) => ({
							status: "failed",
							playlist,
							code: "http-500",
							message: "Server error",
						})),
					};
				},
			},
		}),
		/** Returns its `returns` setting as its result, so a test can break the contract. */
		liar: definePlugin({
			...handshake,
			name: "liar",
			mode: ["playlists"],
			instanceSettings: { outputs: z.object({ returns: z.unknown() }) },
			run: {
				async outputs(ctx) {
					calls.push("liar");
					return ctx.instance.returns as OutputResult;
				},
			},
		}),
		thrower: definePlugin({
			...handshake,
			name: "thrower",
			mode: ["playlists"],
			instanceSettings: {
				inputs: z.object({}),
				modifiers: z.object({}),
				outputs: z.object({}),
			},
			run: {
				async inputs() {
					calls.push("thrower");
					throw new Error("input broke");
				},
				async modifiers() {
					calls.push("thrower");
					throw new Error("modifier broke");
				},
				async outputs() {
					calls.push("thrower");
					throw new Error("output broke");
				},
			},
		}),
		songsOnly: definePlugin({
			...handshake,
			name: "songs-only",
			mode: ["songs"],
			instanceSettings: { outputs: z.object({}) },
			run: {
				async outputs(ctx) {
					calls.push("songs-only");
					return writtenAll(ctx.songs);
				},
			},
		}),
		/** Needs a Plex grant, and hides the `AuthFailure` inside its own error. */
		authed: definePlugin({
			...handshake,
			name: "authed",
			mode: ["playlists"],
			auth: defineAuth({ service: "plex", flow: "token", fields: z.object({ token: z.string() }) }),
			instanceSettings: { inputs: z.object({}) },
			run: {
				async inputs(ctx) {
					calls.push("authed");
					try {
						const { token } = await ctx.auth.get();
						return { playlists: [{ name: token, songs: [] }] };
					} catch (error) {
						throw new Error(`Could not reach Plex: ${String(error)}`);
					}
				},
			},
		}),
		/** Requires persistent and instance settings, and reports what it parsed. */
		configured: definePlugin({
			...handshake,
			name: "configured",
			mode: ["playlists"],
			persistentSettings: z.object({ server: z.string().min(1) }),
			instanceSettings: { inputs: z.object({ limit: z.number().int().default(10) }) },
			run: {
				async inputs(ctx) {
					calls.push("configured");
					const name = `${ctx.persistent.server}:${ctx.instance.limit}:${ctx.configDir}`;
					return { playlists: [{ name, songs: [] }] };
				},
			},
		}),
	};

	const registry: PluginRegistry = Object.fromEntries(
		Object.values(plugins).map((plugin) => [
			plugin.name,
			{ path: `fixtures/${plugin.name}`, load: async () => ({ default: plugin }) },
		]),
	);

	return { registry, calls, received };
}
