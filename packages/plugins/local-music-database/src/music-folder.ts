import { readdir, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** The setting's title, which every message about the folder names. */
export const MUSIC_FOLDER = "music folder";

/** The account-wide settings (spec #179, "Settings"): one music folder serves every applet. */
export const musicSettings = z.object({
	musicDir: withMeta(
		z
			.string()
			.trim()
			.min(1, { message: "Choose the folder your music is in", abort: true })
			.refine(isAbsolute, "Expected an absolute path, such as /music"),
		{
			title: MUSIC_FOLDER,
			description: "The folder holding your music files, as ultrasonics sees it.",
			placeholder: "/music",
		},
	),
});

/** Why `musicDir` can't be scanned, or `undefined` when it is a folder. */
export async function musicFolderProblem(
	musicDir: string | undefined,
): Promise<string | undefined> {
	if (!musicDir) return `The ${MUSIC_FOLDER} isn't set. Choose it in this plugin's settings.`;
	try {
		if (!(await stat(musicDir)).isDirectory())
			return `The ${MUSIC_FOLDER} ${musicDir} isn't a folder.`;
	} catch {
		return `The ${MUSIC_FOLDER} ${musicDir} doesn't exist, or ultrasonics can't see it.`;
	}
	try {
		await readdir(musicDir);
		return undefined;
	} catch {
		return `ultrasonics can't list the files in the ${MUSIC_FOLDER} ${musicDir}.`;
	}
}
