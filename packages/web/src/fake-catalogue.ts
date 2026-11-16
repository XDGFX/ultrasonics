import { defineAuth, withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import type { FakePlugin } from "./fake-api.ts";

// Zod fixtures standing in for the official plugins, so the fake's forms come from `toFormSchema`.

export const spotify: FakePlugin = {
	name: "spotify",
	description: "playlists from your spotify library",
	version: "2.0.0",
	mode: ["playlists"],
	auth: defineAuth({
		service: "spotify",
		flow: "oauth2-pkce",
		scopes: ["playlist-read-private", "playlist-read-collaborative", "user-library-read"],
	}),
	// The real plugin's union (spec #136), by link rather than by name.
	instanceSettings: {
		inputs: z.discriminatedUnion("source", [
			withMeta(
				z.object({
					source: withMeta(z.literal("all"), { title: "which playlists" }),
					exclude: withMeta(z.string().optional(), {
						title: "leave out",
						description: "playlist names to skip, comma-separated",
					}),
				}),
				{
					title: "all my playlists",
					description: "every playlist you own or collaborate on",
					warning:
						"playlists you only follow can't be read: spotify's development mode reads only playlists you own or collaborate on.",
				},
			),
			withMeta(
				z.object({
					source: z.literal("chosen"),
					playlists: withMeta(z.string().trim().min(1), {
						title: "playlist links",
						description:
							"comma-separated. in spotify, choose share, then copy link to playlist. a uri or an id works too.",
						placeholder: "https://open.spotify.com/playlist/…",
					}),
				}),
				{
					title: "playlists i choose",
					description:
						"only the playlists you link. playlists you only follow can't be read in spotify's development mode.",
				},
			),
			withMeta(
				z.object({
					source: z.literal("liked"),
					name: withMeta(z.string().trim().min(1).default("liked songs"), {
						title: "playlist name",
					}),
				}),
				{
					title: "liked songs",
					description: "your liked songs, as one playlist",
					warning: "songs come newest first, by when you liked them.",
				},
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
