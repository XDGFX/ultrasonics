// A plugin using every part of the contract, written as a plugin author would: no casts. Code, so it
// lives outside `test/fixtures`, where the type-check would not see it.
import { z } from "zod";
import { defineAuth, definePlugin, withMeta } from "../src/index.ts";

export const examplePlugin = definePlugin({
	name: "example",
	description: "Reads and writes playlists on an example server",
	version: "1.0.0",
	mode: ["playlists"],
	auth: defineAuth({
		service: "plex",
		flow: "token",
		fields: z.object({
			serverUrl: withMeta(z.string().url(), { title: "Server URL" }),
			token: withMeta(z.string().min(1), { title: "Token", secret: true }),
		}),
	}),
	persistentSettings: z.object({ prefix: z.string().default("") }),
	instanceSettings: {
		inputs: z.discriminatedUnion("mode", [
			z.object({ mode: z.literal("playlists"), names: z.string().min(1) }),
			z.object({ mode: z.literal("saved"), limit: z.number().int().min(1).default(50) }),
		]),
		modifiers: z.object({ suffix: z.string().default(" (copy)") }),
		outputs: z.object({ existing: z.enum(["append", "update"]).default("append") }),
	},
	run: {
		async inputs(ctx) {
			const { serverUrl } = await ctx.auth.get();
			ctx.log.info(`Reading from ${serverUrl}`);
			if (ctx.instance.mode === "saved") {
				const songs = [{ title: "Strobe", artists: ["deadmau5"] }].slice(0, ctx.instance.limit);
				return { playlists: [{ name: `${ctx.persistent.prefix}Saved`, songs }] };
			}
			return {
				playlists: ctx.instance.names
					.split(",")
					.map((name) => ({ name: `${ctx.persistent.prefix}${name.trim()}`, songs: [] })),
			};
		},
		async modifiers(ctx) {
			return {
				playlists: ctx.songs.playlists.map((playlist) => ({
					...playlist,
					name: `${playlist.name}${ctx.instance.suffix}`,
				})),
			};
		},
		async outputs(ctx) {
			await ctx.auth.get();
			return {
				playlists: ctx.songs.playlists.map((playlist, position) =>
					playlist.songs.length === 0
						? {
								status: "skipped",
								playlist: position,
								code: "empty",
								message: "Nothing to write",
							}
						: { status: "written", playlist: position, unmatched: [] },
				),
			};
		},
	},
	async test(ctx) {
		const { serverUrl } = await ctx.auth.get();
		return serverUrl.startsWith("https:")
			? { ok: true }
			: { ok: false, code: "misconfigured", message: "Use HTTPS" };
	},
});
