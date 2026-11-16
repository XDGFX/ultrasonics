// A fixture plugin for the `WorkerExecutor`, loaded by path as production plugins are. Its input's
// `act` setting picks what it does, including the ways a plugin can break its worker. Code, so it
// lives outside `test/fixtures`, where the type-check would not see it.
import { defineAuth, definePlugin, type SongDictInput } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A dict of `count` songs in one playlist, the same each time for the same count. */
export function songs(count: number): SongDictInput {
	return {
		playlists: [
			{
				name: "Probe",
				songs: Array.from({ length: count }, (_, i) => ({
					title: `Song ${i}`,
					artists: [`Artist ${i % 97}`],
					album: `Album ${i % 13}`,
					durationMs: 180_000 + i,
				})),
			},
		],
	};
}

export const Act = z.enum([
	"songs",
	"log",
	"credentials",
	"catch-credentials",
	"throw",
	"floating-rejection",
	"exit",
	"post-garbage",
]);
export type Act = z.infer<typeof Act>;

export default definePlugin({
	name: "probe",
	description: "A fixture plugin for the worker executor",
	version: "1.0.0",
	mode: ["playlists"],
	auth: defineAuth({ service: "plex", flow: "token", fields: z.object({ token: z.string() }) }),
	instanceSettings: {
		inputs: z.object({ act: Act, count: z.number().default(1) }),
		outputs: z.object({}),
	},
	run: {
		async inputs(ctx) {
			switch (ctx.instance.act) {
				case "songs":
					return songs(ctx.instance.count);
				case "log":
					ctx.log.debug("quiet");
					ctx.log.warn("loud");
					return songs(1);
				case "credentials": {
					const { token } = await ctx.auth.get();
					return { playlists: [{ name: token, songs: [] }] };
				}
				case "catch-credentials":
					try {
						await ctx.auth.get();
						throw new Error("credentials resolved");
					} catch (caught) {
						// Hands back what reached the plugin, so a test can compare it to what the host threw.
						return { caught } as unknown as SongDictInput;
					}
				case "throw":
					throw new Error("the probe threw");
				case "floating-rejection":
					void Promise.reject(new Error("the probe rejected in the background"));
					return new Promise<never>(() => {});
				case "exit":
					return process.exit(7);
				case "post-garbage":
					postMessage({ kind: "gibberish" });
					return new Promise<never>(() => {});
			}
		},
		async outputs(ctx) {
			return {
				playlists: ctx.songs.playlists.map((_, playlist) => ({
					status: "written",
					playlist,
					unmatched: [],
				})),
			};
		},
	},
});
