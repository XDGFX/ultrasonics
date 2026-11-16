import { isAbsolute } from "node:path";
import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { fileNameProblems } from "./file-name.ts";
import { isSongPlaceholder } from "./song-line.ts";
import { parseTemplate, placeholdersOf } from "./template.ts";

/** Why a line pattern can't render: a brace out of place, or placeholders it doesn't know. */
export function patternProblems(pattern: string): string[] {
	const parsed = parseTemplate(pattern);
	if (!parsed.ok) return [parsed.problem];
	const unknown = placeholdersOf(parsed.parts).filter((name) => !isSongPlaceholder(name));
	if (unknown.length === 0) return [];
	return [
		`Unknown placeholder${unknown.length === 1 ? "" : "s"}: ${unknown.map((name) => `{${name}}`).join(", ")}. Use {title}, {artist}, {artists}, {album}, {date}, {isrc}, {location} or {id.<service>}.`,
	];
}

const reportEach =
	(problemsOf: (value: string) => string[]) => (value: string, ctx: z.RefinementCtx) => {
		for (const message of problemsOf(value)) ctx.addIssue({ code: "custom", message });
	};

/** What the `outputs` component writes (spec #180, "Instance settings"). */
export const outputSettings = z.object({
	dir: withMeta(
		z
			.string()
			.trim()
			.min(1, "Choose a folder")
			.refine(isAbsolute, "The folder must be an absolute path, such as /playlists"),
		{
			title: "folder",
			description: "The folder the files are written into. It must already exist.",
			placeholder: "/playlists",
		},
	),
	fileName: withMeta(z.string().superRefine(reportEach(fileNameProblems)).default("{name}.txt"), {
		title: "file name",
		description:
			"{name} becomes the playlist's name. Without {name}, every playlist goes into one file.",
	}),
	pattern: withMeta(
		z.string().superRefine(reportEach(patternProblems)).default("{artist} - {title}"),
		{
			title: "line pattern",
			description:
				"One line per song. Use {title}, {artist}, {artists}, {album}, {date}, {isrc}, {location} or {id.<service>}, such as {id.spotify}; {{ and }} write a brace. A song missing a field the pattern uses is left out.",
		},
	),
	existing: withMeta(z.enum(["overwrite", "append"]).default("overwrite"), {
		title: "existing files",
		warning: "Overwrite replaces the file on every run.",
	}),
});
export type OutputSettings = z.output<typeof outputSettings>;
