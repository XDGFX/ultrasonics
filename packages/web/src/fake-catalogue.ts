import { defineAuth, withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import type { FakePlugin } from "./fake-api.ts";

// Zod fixtures standing in for the official plugins, so the fake's forms come from `toFormSchema`.

export const spotify: FakePlugin = {
	name: "spotify",
	description: "playlists from your spotify library",
	version: "2.0.0",
	mode: ["playlists"],
	auth: defineAuth({ service: "spotify", flow: "oauth2-pkce", scopes: ["playlist-read-private"] }),
	instanceSettings: {
		inputs: z.discriminatedUnion("source", [
			withMeta(
				z.object({
					source: withMeta(z.literal("saved"), { title: "which playlists" }),
					includeLiked: withMeta(z.boolean().default(false), { title: "include liked songs" }),
				}),
				{ title: "all saved playlists", description: "every playlist in your library" },
			),
			withMeta(
				z.object({
					source: z.literal("chosen"),
					names: withMeta(z.string().min(1), {
						title: "playlist names",
						description: "comma-separated, as they appear in spotify",
						placeholder: "discover weekly, release radar",
					}),
				}),
				{ title: "playlists i choose", description: "only the playlists you name" },
			),
		]),
	},
};

export const plex: FakePlugin = {
	name: "plex",
	description: "writes playlists to a plex music library",
	version: "2.0.0",
	mode: ["playlists"],
	auth: defineAuth({
		service: "plex",
		flow: "token",
		fields: z.object({
			address: withMeta(z.string().min(1), {
				title: "server address",
				placeholder: "http://192.168.1.10:32400",
			}),
			token: withMeta(z.string().min(1), { title: "plex token", secret: true }),
		}),
	}),
	persistentSettings: z.object({
		library: withMeta(z.string().default("music"), { title: "music library" }),
	}),
	instanceSettings: {
		outputs: withMeta(
			z.object({
				update: withMeta(z.enum(["replace", "append"]).default("replace"), {
					title: "update mode",
					warning: "replace removes existing songs from the playlist",
				}),
			}),
			{ description: "how plex playlists are written" },
		),
	},
};

export const deduplicate: FakePlugin = {
	name: "deduplicate",
	description: "removes repeated songs",
	version: "2.0.0",
	mode: ["songs"],
	instanceSettings: { modifiers: z.object({}) },
};

export const catalogue = [spotify, plex, deduplicate];
