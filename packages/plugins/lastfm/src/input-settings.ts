import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** The most songs one applet reads, and how many a blank `limit` reads (spec #185). */
export const songLimit = { max: 1_000, default: 50 } as const;

/** Last.fm's own `period` values for `user.getTopTracks`. */
export const periods = ["overall", "7day", "1month", "3month", "6month", "12month"] as const;

/** How long ago a `recent` window ends. */
export const endings = ["now", "7d", "1m", "3m", "6m", "1y", "2y"] as const;

/** How long a `recent` window lasts. */
export const spans = ["1d", "7d", "1m", "3m", "6m", "1y"] as const;

// A union of flat objects is the form subset's only conditional shape (ADR-0019 §3), so every
// variant repeats these three.
const common = {
	username: withMeta(z.string().trim().min(1, "Name the Last.fm user to read"), {
		title: "Last.fm username",
		description: "Whose listening to read. Anyone with a public profile, not only you.",
	}),
	limit: withMeta(z.number().int().min(1).max(songLimit.max).default(songLimit.default), {
		title: "song limit",
		description: `The most songs to read, up to ${songLimit.max}. Blank reads ${songLimit.default}.`,
	}),
	name: withMeta(z.string().trim().min(1).default("last.fm songs"), {
		title: "playlist name",
		description: "What to call the songs on the way through.",
	}),
};

const loved = withMeta(z.object({ select: z.literal("loved"), ...common }), {
	title: "loved tracks",
	description: "The tracks the user has loved, newest first.",
});

const top = withMeta(
	z.object({
		select: z.literal("top"),
		...common,
		period: withMeta(z.enum(periods).default("overall"), {
			title: "period",
			description:
				"overall is all time; 7day is the last 7 days; 1month, 3month, 6month and 12month the last 1, 3, 6 or 12 months.",
		}),
	}),
	{
		title: "top tracks",
		description: "The user's most played tracks over a period, in rank order.",
	},
);

const recent = withMeta(
	z.object({
		select: z.literal("recent"),
		...common,
		ending: withMeta(z.enum(endings).default("now"), {
			title: "ending",
			description:
				"How long ago the window ends: now, or 7 days (7d), 1, 3 or 6 months (1m, 3m, 6m), or 1 or 2 years (1y, 2y) ago.",
		}),
		span: withMeta(z.enum(spans).default("7d"), {
			title: "span",
			description:
				"How long the window lasts: 1 or 7 days (1d, 7d), 1, 3 or 6 months (1m, 3m, 6m), or a year (1y).",
		}),
	}),
	{
		title: "recent tracks",
		description: "The tracks the user scrobbled in a window, each once, most recent first.",
	},
);

/** What the `inputs` component reads (spec #185, "Instance settings"). */
export const inputSettings = z.discriminatedUnion("select", [loved, top, recent]);
export type InputSettings = z.output<typeof inputSettings>;
