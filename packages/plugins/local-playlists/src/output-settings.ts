import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { isAbsolutePath } from "./path-mapping.ts";

/** What the `outputs` component writes to (spec #178, "Instance settings"). */
export const outputSettings = z.object({
	dir: withMeta(
		z
			.string()
			.trim()
			.min(1, "Choose the folder to write your playlists to")
			.refine(isAbsolutePath, "Expected an absolute path, such as /playlists"),
		{
			title: "playlists folder",
			description: "The folder to write .m3u8 files to, as ultrasonics sees it.",
			placeholder: "/playlists",
		},
	),
	backups: withMeta(z.enum(["0", "3", "5", "10"]).default("3"), {
		title: "backups to keep",
		description:
			"Before replacing a playlist file, a copy is kept in ultrasonics' config folder. This is how many runs' copies to keep.",
		warning: "Each playlist file is replaced with the songs this applet sends it.",
	}),
});
export type OutputSettings = z.output<typeof outputSettings>;
