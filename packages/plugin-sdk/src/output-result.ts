import { z } from "zod";

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
