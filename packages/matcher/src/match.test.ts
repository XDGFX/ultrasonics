import { describe, expect, test } from "bun:test";
import { Song, type SongInput } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import handWrittenJson from "../test/fixtures/match-dataset/hand-written.json";
import musicbrainzJson from "../test/fixtures/match-dataset/musicbrainz.json";
import { formatReport, measure } from "./harness.ts";
import { durationToleranceMs, match, threshold } from "./match.ts";
import { MatchCase, trapCategories } from "./match-case.ts";

const song = (input: Partial<SongInput> = {}) =>
	Song.parse({ title: "Strobe", artists: ["deadmau5"], ...input });

describe("match: hard keys", () => {
	test("a shared id matches songs whose text differs entirely", () => {
		const a = song({ title: "Strobe", id: { spotify: "abc", deezer: "1" } });
		const b = song({ title: "Unrelated", artists: ["Someone"], id: { spotify: "abc" } });
		expect(match(a, b)).toEqual({ matched: true, score: 1 });
	});

	test("the same value in different ID spaces is not a shared id", () => {
		const a = song({ title: "Strobe", id: { spotify: "abc" } });
		const b = song({ title: "Unrelated", artists: ["Someone"], id: { deezer: "abc" } });
		expect(match(a, b).matched).toBe(false);
	});

	test("a shared location matches songs whose text differs entirely", () => {
		const location = "file:///music/strobe.flac";
		const a = song({ location });
		const b = song({ title: "Untitled", artists: [], location });
		expect(match(a, b)).toEqual({ matched: true, score: 1 });
	});
});

describe("match: ISRC", () => {
	test("an equal ISRC matches songs whose text differs", () => {
		const a = song({ title: "Strobe", isrc: "USUM70900001" });
		const b = song({ title: "Strobe (Radio Edit)", artists: ["Someone"], isrc: "USUM70900001" });
		expect(match(a, b).matched).toBe(true);
	});

	test("an equal ISRC is still vetoed by a duration gap beyond the tolerance", () => {
		const a = song({ isrc: "USUM70900001", durationMs: 200_000 });
		const b = song({ isrc: "USUM70900001", durationMs: 200_001 + durationToleranceMs });
		expect(match(a, b).matched).toBe(false);
	});
});

describe("match: the title and artist threshold", () => {
	test("the same title and artist match", () => {
		expect(match(song(), song()).matched).toBe(true);
	});

	test("a near title clears the threshold and matches", () => {
		const result = match(song({ title: "Ghosts n Stuff" }), song({ title: "Ghosts 'n' Stuff" }));
		expect(result.matched).toBe(true);
		expect(result.score).toBeGreaterThanOrEqual(threshold);
	});

	test("a different title by the same artist falls below the threshold", () => {
		const result = match(song({ title: "Strobe" }), song({ title: "Some Chords" }));
		expect(result.matched).toBe(false);
		expect(result.score).toBeLessThan(threshold);
	});

	test.each([
		["Love", "Love Story"],
		["Stay", "Stay With Me"],
	])("%p is a different song from %p by the same artist", (left, right) => {
		expect(match(song({ title: left }), song({ title: right })).matched).toBe(false);
	});

	test("a title that drops a subtitle still matches", () => {
		expect(
			match(song({ title: "Chacun sa mer… chacun son vent !" }), song({ title: "Chacun sa mer" }))
				.matched,
		).toBe(true);
	});

	test("the same title by an unrelated artist falls below the threshold", () => {
		const result = match(
			song({ title: "Home", artists: ["Michael Bublé"] }),
			song({ title: "Home", artists: ["Daughtry"] }),
		);
		expect(result.matched).toBe(false);
		expect(result.score).toBeLessThan(threshold);
	});

	test.each([
		["one side", [], ["deadmau5"]],
		["both sides", [], []],
	])("an empty artist list on %s matches only on a hard key", (_, left, right) => {
		expect(match(song({ artists: left }), song({ artists: right })).matched).toBe(false);
		const isrc = "USUM70900001";
		expect(match(song({ artists: left, isrc }), song({ artists: right, isrc })).matched).toBe(true);
	});
});

describe("match: normalisation", () => {
	const pair = (a: Partial<SongInput>, b: Partial<SongInput>) => match(song(a), song(b)).matched;

	test("ignores letter case", () => {
		expect(
			pair(
				{ title: "Mr. Brightside", artists: ["The Killers"] },
				{ title: "MR. BRIGHTSIDE", artists: ["THE KILLERS"] },
			),
		).toBe(true);
	});

	test("ignores accents in titles and artists", () => {
		expect(
			pair({ title: "Café", artists: ["Beyoncé"] }, { title: "Cafe", artists: ["Beyonce"] }),
		).toBe(true);
	});

	test.each([
		"Stay (feat. Justin Bieber)",
		"Stay [ft. Justin Bieber]",
		"Stay feat. Justin Bieber",
		"Stay (featuring Justin Bieber & Someone Else)",
	])("drops the feat. credit in %p", (title) => {
		expect(
			pair(
				{ title, artists: ["The Kid LAROI"] },
				{ title: "Stay", artists: ["The Kid LAROI", "Justin Bieber"] },
			),
		).toBe(true);
	});

	test.each([
		"Stay (prod. Cashmere Cat)",
		"Stay [Prod. by Cashmere Cat]",
		"Stay prod. Cashmere Cat",
	])("drops the prod. credit in %p", (title) => {
		expect(pair({ title }, { title: "Stay" })).toBe(true);
	});

	test.each([
		"Midnight City (Album Version)",
		"Midnight City [Official Audio]",
		"Midnight City - Single Version",
	])("drops the bracketed noise in %p", (title) => {
		expect(pair({ title }, { title: "Midnight City" })).toBe(true);
	});

	test.each([["Flume & Kai"], ["Flume, Kai"], ["Flume x Kai"], ["Flume and Kai"]])(
		"reads %p as the list of its artists",
		(joined) => {
			expect(
				pair(
					{ title: "Never Be Like You", artists: [joined] },
					{ title: "Never Be Like You", artists: ["Flume", "Kai"] },
				),
			).toBe(true);
		},
	);

	test("lets a year agree with a full date", () => {
		expect(pair({ date: "2016" }, { date: "2016-06-16" })).toBe(true);
	});
});

describe("match: vetoes", () => {
	const pair = (a: Partial<SongInput>, b: Partial<SongInput>) => match(song(a), song(b)).matched;

	test.each([
		"Creep - Live",
		"Creep (Live at Glastonbury 1997)",
		"Creep (Unplugged)",
		"Creep (Skrillex Remix)",
		"Creep - Extended Mix",
		"Creep - Radio Edit",
		"Creep (Single Edit)",
		"Creep - Acoustic",
		"Creep (Instrumental)",
		"Creep (Karaoke Version)",
		"Creep (Cover)",
		"Creep (In the Style of Radiohead)",
		"Creep (Re-Recorded)",
		"Creep (Re‐recorded)",
		"Creep (Taylor’s Version)",
		"Creep (Demo)",
		"Creep (Club Mix)",
	])("vetoes the version marker in %p on one side only", (title) => {
		expect(pair({ title: "Creep" }, { title })).toBe(false);
	});

	test("reads an original mix as the plain recording", () => {
		expect(pair({ title: "Creep (Original Mix)" }, { title: "Creep" })).toBe(true);
	});

	test("lets the same version marker on both sides match", () => {
		expect(pair({ title: "Creep - Live" }, { title: "Creep (Live)" })).toBe(true);
	});

	test("reads a marker word inside the song's own name as the name", () => {
		expect(pair({ title: "Live Forever" }, { title: "Live Forever" })).toBe(true);
	});

	test.each(["Wish You Were Here - Remastered 2011", "Wish You Were Here (2009 Remaster)"])(
		"never vetoes the remaster marker in %p",
		(title) => {
			expect(pair({ title }, { title: "Wish You Were Here" })).toBe(true);
		},
	);

	test.each([
		[true, false],
		[false, undefined],
	])("never vetoes explicit %p against %p", (left, right) => {
		expect(pair({ explicit: left }, { explicit: right })).toBe(true);
	});

	test("vetoes a duration gap beyond the tolerance", () => {
		expect(pair({ durationMs: 200_000 }, { durationMs: 200_001 + durationToleranceMs })).toBe(
			false,
		);
	});

	test("lets a duration gap within the tolerance match", () => {
		expect(pair({ durationMs: 200_000 }, { durationMs: 200_000 + durationToleranceMs })).toBe(true);
	});

	test("lets a missing duration on one side match", () => {
		expect(pair({ durationMs: 200_000 }, {})).toBe(true);
	});
});

const handWritten = z.array(MatchCase).parse(handWrittenJson);
const tier = [...z.array(MatchCase).parse(musicbrainzJson), ...handWritten];

describe("each hand-written case", () => {
	test.each(
		handWritten.map(
			(c) => [c.provenance.source === "hand-written" ? c.provenance.name : "", c] as const,
		),
	)("%s", (_, c) => {
		expect(measure(match, [c]).byCategory[c.category].met).toBe(true);
	});
});

/**
 * The staged-rules matcher's CC0 figures less two points, so a regression fails CI while #132
 * works towards the spec's targets, which the report still shows as met or not.
 */
const baseline = {
	recall: 0.74,
	precision: 0.88,
	rejection: {
		cover: 0.98,
		"same-title": 0.98,
		edit: 0.94,
		live: 0.92,
		"re-recording": 0.71,
		remix: 0.66,
	},
} as const satisfies {
	recall: number;
	precision: number;
	rejection: Record<(typeof trapCategories)[number], number>;
};

describe("the CC0 tier", () => {
	const report = measure(match, tier);
	if (!report.allMet) console.log(formatReport(report));

	test(`recall holds its baseline of ${baseline.recall * 100}%`, () => {
		expect(report.recall.rate).toBeGreaterThanOrEqual(baseline.recall);
	});

	test.each([...trapCategories])("rejection of %s holds its baseline", (category) => {
		expect(report.rejection[category].rate).toBeGreaterThanOrEqual(baseline.rejection[category]);
	});

	test(`precision holds its baseline of ${baseline.precision * 100}%`, () => {
		expect(report.precision.rate).toBeGreaterThanOrEqual(baseline.precision);
	});
});
