import { toFileUri, withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** An absolute POSIX, drive or UNC path, judged by shape as `toFileUri` judges it (v1 #22). */
export function isAbsolutePath(path: string): boolean {
	return toFileUri(path) !== undefined;
}

/** A drive or UNC path: absolute, and not starting with `/`. */
function isWindowsShaped(path: string): boolean {
	return !path.startsWith("/") && isAbsolutePath(path);
}

const absoluteMessage = "Expected an absolute path, such as /music or D:/Music";

const root = z
	.string()
	.trim()
	.refine((value) => value === "" || isAbsolutePath(value), absoluteMessage)
	.optional();

/**
 * The account-wide pair translating the player's paths into ultrasonics' own (spec #178,
 * "Persistent settings"). Both or neither: one alone translates nothing.
 */
export const pathMapping = z
	.object({
		playlistRoot: withMeta(root, {
			title: "music folder in your playlists",
			description:
				"Where your playlists say the music is. Leave both blank if ultrasonics sees the same paths.",
			placeholder: "D:/Music",
		}),
		localRoot: withMeta(root, {
			title: "music folder for ultrasonics",
			description: "The same folder, as ultrasonics sees it.",
			placeholder: "/music",
		}),
	})
	.refine((value) => !value.playlistRoot === !value.localRoot, {
		message: "Fill in both music folders, or neither",
		path: ["localRoot"],
	});
export type PathMapping = z.output<typeof pathMapping>;

/** A path a playlist names, as ultrasonics can open it. */
export function toLocalPath(path: string, { playlistRoot, localRoot }: PathMapping): string {
	return playlistRoot && localRoot ? mapPath(path, playlistRoot, localRoot) : path;
}

/** A path ultrasonics opens, as the player's playlists name it. */
export function toPlayerPath(path: string, { playlistRoot, localRoot }: PathMapping): string {
	return playlistRoot && localRoot ? mapPath(path, localRoot, playlistRoot) : path;
}

function trimSeparators(path: string, windows: boolean): string {
	return path.replace(windows ? /[\\/]+$/ : /\/+$/, "");
}

/**
 * `path` with the root `from` swapped for `to`, matched on whole segments at the start only; a
 * path outside `from` comes back as written. Separators convert when exactly one root is
 * Windows-shaped.
 */
export function mapPath(path: string, from: string, to: string): string {
	const windows = isWindowsShaped(from);
	if (isWindowsShaped(path) !== windows) return path;
	const prefix = trimSeparators(from, windows);
	const head = path.slice(0, prefix.length);
	const matches = windows
		? head.replaceAll("\\", "/").toLowerCase() === prefix.replaceAll("\\", "/").toLowerCase()
		: head === prefix;
	const rest = path.slice(prefix.length);
	const startsSegment = rest === "" || (windows ? /^[\\/]/ : /^\//).test(rest);
	if (!matches || !startsSegment) return path;
	const toWindows = isWindowsShaped(to);
	let converted = rest;
	if (windows && !toWindows) converted = rest.replace(/[\\/]/g, "/");
	if (!windows && toWindows) converted = rest.replaceAll("/", "\\");
	return trimSeparators(to, toWindows) + converted;
}
