import { describe, expect, test } from "bun:test";
import { Song, type SongInput } from "@ultrasonics/plugin-sdk";
import { lengthVetoMs } from "./agreement.ts";
import { bestMatch } from "./best-match.ts";
import { candidateSets, handWrittenCases, musicbrainzCases } from "./cc0-tier.ts";
import { floor } from "./floor.ts";
import { formatReport, holds, measure, measureRanking, namedFigures } from "./harness.ts";
import { match } from "./match.ts";
import { heldOutCases, inTuningSplit } from "./split.ts";

/** `match` accepts exactly when its score reaches this. */
const threshold = 0.5;

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

	test("an equal ISRC is still vetoed by a length gap beyond the veto", () => {
		const a = song({ isrc: "USUM70900001", durationMs: 200_000 });
		const b = song({ isrc: "USUM70900001", durationMs: 200_001 + lengthVetoMs });
		expect(match(a, b).matched).toBe(false);
	});
});

describe("match: the weighed threshold", () => {
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

	test("a title that drops a subtitle matches when the lengths agree too", () => {
		const [full, short] = ["Chacun sa mer… chacun son vent !", "Chacun sa mer"];
		expect(match(song({ title: full }), song({ title: short })).matched).toBe(false);
		const durationMs = 200_000;
		expect(
			match(song({ title: full, durationMs }), song({ title: short, durationMs })).matched,
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

	test("compares a title and artist across scripts after transliteration", () => {
		expect(
			pair(
				{ title: "Что за песни", artists: ["Алла Пугачёва"] },
				{ title: "Chto za pesni", artists: ["Alla Pugacheva"] },
			),
		).toBe(true);
	});

	test("ignores album and year, which differ between releases of one recording", () => {
		expect(
			pair(
				{ album: "Random Album Title", date: "2008" },
				{ album: "5 Years of mau5", date: "2014" },
			),
		).toBe(true);
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

	test("vetoes a length gap beyond the veto, however alike the rest", () => {
		expect(pair({ durationMs: 200_000 }, { durationMs: 200_001 + lengthVetoMs })).toBe(false);
	});

	test("lets a length gap of 3 s match", () => {
		expect(pair({ durationMs: 200_000 }, { durationMs: 203_000 })).toBe(true);
	});

	test("weighs a gap just past 3 s against an otherwise equal pair, enough to reject it", () => {
		expect(pair({ durationMs: 200_000 }, { durationMs: 203_001 })).toBe(false);
	});

	test("lets a missing duration on one side match", () => {
		expect(pair({ durationMs: 200_000 }, {})).toBe(true);
	});
});

describe("match: titles and artists with no letters or digits (#162)", () => {
	const symbolic = (title: string, artists = ["Artist"]) =>
		song({ title, artists, durationMs: 200_000 });

	test.each([
		["?", "!"],
		["💔", "?"],
		["?", "??"],
		["!!", "!!!"],
	])("a title of %p is a different song from %p", (left, right) => {
		expect(match(symbolic(left), symbolic(right)).matched).toBe(false);
	});

	test.each([["???"], ["!!"]])("an artist of %p is a different artist from !!!", (other) => {
		const a = symbolic("Myth Takes", ["!!!"]);
		expect(match(a, symbolic("Myth Takes", [other])).matched).toBe(false);
	});

	test("a symbol title keeps its decorations, so a remaster still matches", () => {
		expect(match(symbolic("?"), symbolic("? (Remastered 2011)")).matched).toBe(true);
	});

	test("a symbol title keeps its version marker, so a live take is vetoed", () => {
		expect(match(symbolic("?"), symbolic("? (Live)")).score).toBe(0);
	});

	test("bestMatch picks the candidate whose symbols agree", () => {
		const candidates = [symbolic("!"), symbolic("?")];
		expect(bestMatch(symbolic("?"), candidates)?.index).toBe(1);
	});

	test("bestMatch counts an album of other symbols as a different album", () => {
		const onAlbum = (album: string, date: string) => song({ album, date, durationMs: 200_000 });
		const candidates = [onAlbum("!", "2000"), onAlbum("?", "2010")];
		expect(bestMatch(onAlbum("?", "2010"), candidates)?.index).toBe(1);
	});
});

describe("each hand-written case", () => {
	test.each(
		handWrittenCases.map(
			(c) => [c.provenance.source === "hand-written" ? c.provenance.name : "", c] as const,
		),
	)("%s", (_, c) => {
		expect(measure(match, [c]).byCategory[c.category].rate).toBe(1);
	});
});

describe("the CC0 tier, held out, holds its floor", () => {
	const report = measure(match, heldOutCases([...musicbrainzCases, ...handWrittenCases]));
	const ranking = measureRanking(
		bestMatch,
		candidateSets.filter((set) => !inTuningSplit({ ...set.trap, category: set.category })),
	);
	const figures = namedFigures(report, ranking);
	if (!figures.every((f) => holds(f, floor))) console.log(formatReport(report, ranking, floor));

	test.each(figures.map((f) => [f.name, f] as const))("%s", (_, f) => {
		expect(holds(f, floor)).toBe(true);
	});
});
