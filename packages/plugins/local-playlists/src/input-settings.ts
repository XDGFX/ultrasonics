import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { isAbsolutePath } from "./path-mapping.ts";

/** What the `inputs` component reads (spec #178, "Instance settings"). */
export const inputSettings = z.object({
	dir: withMeta(
		z
			.string()
			.trim()
			.min(1, "Choose the folder your playlists are in")
			.refine(isAbsolutePath, "Expected an absolute path, such as /playlists"),
		{
			title: "playlists folder",
			description: "The folder holding your .m3u and .m3u8 files, as ultrasonics sees it.",
			placeholder: "/playlists",
		},
	),
	recursive: withMeta(z.boolean().default(false), {
		title: "include subfolders",
		description: "Read playlists in folders inside this one too.",
	}),
	filter: withMeta(z.string().optional(), {
		title: "only these playlists",
		description: "Comma-separated names. * matches anything, ? one character. Case doesn't matter.",
		placeholder: "rock*, chill?",
	}),
});
export type InputSettings = z.output<typeof inputSettings>;
