import { definePlugin, withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { mergeByName } from "./merge.ts";

/**
 * Combines same-named playlists from several inputs into one each (spec #186). It has no settings:
 * duplicates are whatever the shared matcher says they are.
 */
export const playlistMerger = definePlugin({
	name: "playlist-merger",
	description: "Combines playlists that share a name into one",
	version: "1.0.0",
	mode: ["playlists"],
	instanceSettings: {
		modifiers: withMeta(z.object({}), {
			description:
				"Playlists with the same name, ignoring case and spaces at either end, become one. It keeps the first one's songs in order, then adds the songs only later ones have.",
		}),
	},
	run: {
		async modifiers(ctx) {
			return { playlists: mergeByName(ctx.songs.playlists, ctx.log) };
		},
	},
});
