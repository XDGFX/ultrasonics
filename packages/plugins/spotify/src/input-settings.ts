import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

const playlistId = "([A-Za-z0-9]{22})";

/** A link (an `intl-xx` locale segment allowed, a query ignored), a URI, or a bare id. */
const playlistReference = [
	new RegExp(
		`^https?://open\\.spotify\\.com/(?:intl-[a-z]{2}(?:-[a-z]{2,4})?/)?playlist/${playlistId}/?(?:[?#].*)?$`,
	),
	new RegExp(`^spotify:playlist:${playlistId}$`),
	new RegExp(`^${playlistId}$`),
];

/** The entries of a comma-separated list, trimmed, blanks dropped. */
export function listEntries(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

/** The playlist id an entry names, or `undefined` when it names none. */
export function playlistIdOf(entry: string): string | undefined {
	for (const pattern of playlistReference) {
		const id = pattern.exec(entry)?.[1];
		if (id) return id;
	}
	return undefined;
}

const followedWarning =
	"Playlists you only follow can't be read: Spotify's development mode reads only playlists you own or collaborate on.";

const chosen = withMeta(
	z.object({
		source: z.literal("chosen"),
		playlists: withMeta(
			z
				.string()
				.trim()
				.min(1, "Paste at least one playlist link")
				.superRefine((value, ctx) => {
					const entries = listEntries(value);
					if (entries.length === 0) {
						ctx.addIssue({ code: "custom", message: "Paste at least one playlist link" });
					}
					for (const entry of entries) {
						if (playlistIdOf(entry) === undefined) {
							ctx.addIssue({
								code: "custom",
								message: `Not a Spotify playlist link, URI or id: "${entry}"`,
							});
						}
					}
				}),
			{
				title: "playlist links",
				description:
					"Comma-separated. In Spotify, choose Share, then Copy link to playlist. A URI or an id works too.",
				placeholder: "https://open.spotify.com/playlist/…",
			},
		),
	}),
	{
		title: "playlists i choose",
		description: `Only the playlists you link, in the order you list them. ${followedWarning}`,
	},
);

const all = withMeta(
	z.object({
		source: z.literal("all"),
		exclude: withMeta(z.string().optional(), {
			title: "leave out",
			description: "Playlist names to skip, comma-separated. Case doesn't matter.",
		}),
	}),
	{
		title: "all my playlists",
		description: "Every playlist you own or collaborate on.",
		warning: followedWarning,
	},
);

const liked = withMeta(
	z.object({
		source: z.literal("liked"),
		name: withMeta(z.string().trim().min(1).default("liked songs"), {
			title: "playlist name",
			description: "What to call your liked songs on the way through.",
		}),
	}),
	{
		title: "liked songs",
		description: "Your Liked Songs, as one playlist.",
		warning: "Songs come newest first, by when you liked them.",
	},
);

/**
 * What the `inputs` component reads (spec #136, "Instance settings"). `all` comes first because a
 * new slot takes the first variant's defaults, and only `all` is valid before anything is typed.
 */
export const inputSettings = z.discriminatedUnion("source", [all, chosen, liked]);
export type InputSettings = z.output<typeof inputSettings>;
