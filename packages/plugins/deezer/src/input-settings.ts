import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A `deezer.com` link (a locale segment and a query allowed), or a bare numeric id. */
const playlistReference = [
	/^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/(\d+)\/?(?:[?#].*)?$/i,
	/^(\d+)$/,
];

/** Deezer's share links, which only a redirect turns into a playlist id. */
const shortLink = /^(?:https?:\/\/)?(?:link\.deezer\.com|deezer\.page\.link)\//i;

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

const atLeastOne = "Paste at least one playlist link";

/** What a short link's issue tells the user to do instead. */
export const copyFullAddress =
	"Open it, then copy the full deezer.com/…/playlist/… address from your browser.";

/** What the `inputs` component reads (spec #184, "Instance settings"). */
export const inputSettings = z.object({
	playlists: withMeta(
		z
			.string()
			.trim()
			.min(1, atLeastOne)
			.superRefine((value, ctx) => {
				const entries = listEntries(value);
				if (entries.length === 0) ctx.addIssue({ code: "custom", message: atLeastOne });
				for (const entry of entries) {
					if (shortLink.test(entry)) {
						ctx.addIssue({
							code: "custom",
							message: `"${entry}" is a short link. ${copyFullAddress}`,
						});
					} else if (playlistIdOf(entry) === undefined) {
						ctx.addIssue({
							code: "custom",
							message: `Not a Deezer playlist link or id: "${entry}"`,
						});
					}
				}
			}),
		{
			title: "playlist links",
			description:
				"Comma-separated deezer.com playlist links, or their numeric ids. Only public playlists can be read: Deezer no longer registers the developer apps that reading private ones needs.",
			placeholder: "https://www.deezer.com/playlist/…",
		},
	),
});
export type InputSettings = z.output<typeof inputSettings>;
