import { Song } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

export const positiveCategories = ["plain", "remaster", "clean-explicit"] as const;
export const trapCategories = [
	"cover",
	"live",
	"edit",
	"remix",
	"re-recording",
	"same-title",
] as const;

export const PositiveCategory = z.enum(positiveCategories);
export type PositiveCategory = z.output<typeof PositiveCategory>;
export const TrapCategory = z.enum(trapCategories);
export type TrapCategory = z.output<typeof TrapCategory>;
export const Category = z.enum([...positiveCategories, ...trapCategories]);
export type Category = z.output<typeof Category>;

/** The matcher's normalisation rules and vetoes (spec #117, `match`), which hand-written cases must cover. */
export const Rule = z.enum([
	"case",
	"accents",
	"feat-credit",
	"prod-credit",
	"bracketed-noise",
	"artist-join",
	"partial-date",
	"remaster-marker",
	"explicit-flag",
	"live-marker",
	"remix-marker",
	"edit-marker",
	"acoustic-marker",
	"instrumental-marker",
	"cover-marker",
	"re-recorded-marker",
	"duration-gap",
	"threshold",
]);
export type Rule = z.output<typeof Rule>;

/** A shared `id` or `location` would short-circuit to a hard match the dataset isn't measuring. */
const CaseSong = Song.refine(
	(song) => Object.keys(song.id).length === 0 && song.location === undefined,
	"A song in a match case carries no id and no location",
);

/** The services the service tier is fetched from (spec #117, "The service tier"). */
export const ServiceName = z.enum(["spotify", "deezer"]);
export type ServiceName = z.output<typeof ServiceName>;

const remasterMarker = /remaster/i;

/** A positive with a remaster marker on one side only is a remaster positive (#104 §2). */
export function oneSideRemastered(
	a: { title: string; album?: string | null },
	b: { title: string; album?: string | null },
): boolean {
	const marked = (song: typeof a) => remasterMarker.test(`${song.title} ${song.album ?? ""}`);
	return marked(a) !== marked(b);
}

const MusicBrainzSide = z.object({
	isrc: z.string().optional(),
	recording: z.uuid(),
});

export const Provenance = z.discriminatedUnion("source", [
	z.object({ source: z.literal("musicbrainz"), a: MusicBrainzSide, b: MusicBrainzSide }),
	z.object({
		source: z.literal("hand-written"),
		/** What the case shows, so a failing test names the case it broke. */
		name: z.string().min(1),
		covers: z.array(Rule).min(1),
	}),
	z.object({
		source: z.literal("service"),
		a: z.object({ service: ServiceName, isrc: z.string() }),
		b: z.object({ service: ServiceName, isrc: z.string() }),
	}),
]);
export type Provenance = z.output<typeof Provenance>;

export const Label = z.enum(["match", "no-match"]);
export type Label = z.output<typeof Label>;

export function isPositive(category: Category): category is PositiveCategory {
	return PositiveCategory.safeParse(category).success;
}

export const MatchCase = z
	.object({
		a: CaseSong,
		b: CaseSong,
		label: Label,
		category: Category,
		provenance: Provenance,
	})
	.refine(
		(c) => (c.label === "match") === isPositive(c.category),
		"Positive categories are labelled match, trap categories no-match",
	);
export type MatchCase = z.output<typeof MatchCase>;
export type MatchCaseInput = z.input<typeof MatchCase>;
