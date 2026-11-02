import { z } from "zod";
import type { SongDict } from "./song-dict.ts";
import { issuesOf, type ValidationIssue } from "./validation-issue.ts";

/** What an output did with one playlist, which it names by position in `ctx.songs` (ADR-0020). */
export const PlaylistResult = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("written"),
		playlist: z.number().int(),
		/** Positions within that playlist's songs. */
		unmatched: z.array(z.number().int()),
	}),
	z.object({
		status: z.literal("skipped"),
		playlist: z.number().int(),
		code: z.string(),
		message: z.string(),
	}),
	z.object({
		status: z.literal("failed"),
		playlist: z.number().int(),
		code: z.string(),
		message: z.string(),
	}),
]);
export type PlaylistResult = z.infer<typeof PlaylistResult>;

/** What every output returns: one entry per playlist it received, each exactly once. */
export const OutputResult = z.object({ playlists: z.array(PlaylistResult) });
export type OutputResult = z.infer<typeof OutputResult>;

/**
 * Why `result` is not a complete output result for `songs` (ADR-0020 §2, §4): its shape, then each
 * playlist exactly once and each unmatched song in range and at most once. The runner and
 * conformance both judge an output by this, so they cannot disagree.
 */
export function outputResultIssues(result: unknown, songs: SongDict): ValidationIssue[] {
	const parsed = OutputResult.safeParse(result);
	if (!parsed.success) return issuesOf(parsed.error);

	const issues: ValidationIssue[] = [];
	const seen = new Set<number>();
	for (const [index, entry] of parsed.data.playlists.entries()) {
		const at = ["playlists", index];
		const playlist = songs.playlists[entry.playlist];
		if (playlist === undefined) {
			issues.push({
				path: [...at, "playlist"],
				message: `No playlist at position ${entry.playlist}`,
			});
			continue;
		}
		if (seen.has(entry.playlist)) {
			issues.push({
				path: [...at, "playlist"],
				message: `Playlist ${entry.playlist} appears twice`,
			});
		}
		seen.add(entry.playlist);
		if (entry.status !== "written") continue;
		const unmatched = new Set<number>();
		for (const [position, song] of entry.unmatched.entries()) {
			const path = [...at, "unmatched", position];
			if (song < 0 || song >= playlist.songs.length) {
				issues.push({ path, message: `No song at position ${song}` });
			} else if (unmatched.has(song)) {
				issues.push({ path, message: `Song ${song} is unmatched twice` });
			}
			unmatched.add(song);
		}
	}
	for (const position of songs.playlists.keys()) {
		if (!seen.has(position)) {
			issues.push({ path: ["playlists"], message: `Playlist ${position} has no entry` });
		}
	}
	return issues;
}
