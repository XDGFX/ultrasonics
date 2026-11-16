import { describe, expect, test } from "bun:test";
import type { Song } from "@ultrasonics/plugin-sdk";
import { CandidateSet } from "./candidate-set.ts";
import {
	holds,
	measure,
	measureRanking,
	type NamedFigure,
	namedFigures,
	type PairwiseFunction,
	type PickFunction,
	wilson,
} from "./harness.ts";
import {
	type Category,
	isPositive,
	MatchCase,
	type MatchCaseInput,
	positiveCategories,
} from "./match-case.ts";

function pair(category: Category, title: string): MatchCaseInput {
	return {
		a: { title, artists: ["Artist"], isrc: "GBAAA0000001" },
		b: { title, artists: ["Artist"], isrc: isPositive(category) ? "GBAAA0000001" : "GBAAA0000002" },
		label: isPositive(category) ? "match" : "no-match",
		category,
		provenance: { source: "hand-written", name: title, covers: ["threshold"] },
	};
}

/** Each category's cases carry their category in the title, so a stub can read the answer. */
const fixture = (
	[
		["plain", 4],
		["remaster", 2],
		["clean-explicit", 2],
		["cover", 2],
		["live", 2],
		["edit", 1],
		["remix", 1],
		["re-recording", 1],
		["same-title", 3],
	] as const
).flatMap(([category, n]) =>
	Array.from({ length: n }, (_, i) => MatchCase.parse(pair(category, `${category} ${i}`))),
);

const alwaysMatch: PairwiseFunction = () => ({ matched: true });
const oracle: PairwiseFunction = (a) => ({
	matched: positiveCategories.some((c) => a.title.startsWith(c)),
});

describe("measure", () => {
	test("always-match gives 100% recall and 0% rejection in every trap category", () => {
		const report = measure(alwaysMatch, fixture);
		expect(report.recall.rate).toBe(1);
		for (const figure of Object.values(report.rejection)) expect(figure.rate).toBe(0);
	});

	test("a perfect oracle scores 100% on every figure", () => {
		const report = measure(oracle, fixture);
		expect(report.recall.rate).toBe(1);
		expect(report.precision.rate).toBe(1);
		for (const figure of Object.values(report.rejection)) expect(figure.rate).toBe(1);
	});

	test("counts recall by script", () => {
		const scripted = (title: string, other: string) =>
			MatchCase.parse({ ...pair("plain", title), b: { title: other, artists: ["Artist"] } });
		const report = measure(alwaysMatch, [
			scripted("Strobe", "Strobe"),
			scripted("Что за песни", "Что за песни"),
			scripted("Что за песни", "Chto za pesni"),
			scripted("폭포의 아래", "Under the waterfall"),
		]);
		expect(report.byScript.latin.n).toBe(1);
		expect(report.byScript["same-non-latin"].n).toBe(1);
		expect(report.byScript["cross-script"].n).toBe(2);
	});

	test("recall counts remaster and clean/explicit pairs as positives", () => {
		expect(measure(alwaysMatch, fixture).recall.n).toBe(8);
	});

	test("precision counts only the pairs called a match", () => {
		// Matches the four plain pairs and one live trap; everything else is left unmatched.
		const some: PairwiseFunction = (a) => ({
			matched: a.title.startsWith("plain") || a.title === "live 0",
		});
		const report = measure(some, fixture);
		expect(report.precision).toMatchObject({ successes: 4, n: 5 });
		expect(report.recall).toMatchObject({ successes: 4, n: 8 });
	});

	test("gives each category its n", () => {
		const report = measure(oracle, fixture);
		expect(report.byCategory["same-title"].n).toBe(3);
		expect(report.byCategory.remaster.n).toBe(2);
		expect(report.rejection.edit.n).toBe(1);
	});

	test("gives a figure with no cases no rate", () => {
		const report = measure(
			oracle,
			fixture.filter((c) => c.category !== "remix"),
		);
		expect(report.rejection.remix).toMatchObject({ n: 0, rate: undefined });
	});

	test("hides the ISRC from the function under test", () => {
		const seen: Song[] = [];
		measure((a, b) => {
			seen.push(a, b);
			return { matched: false };
		}, fixture);
		expect(seen).toHaveLength(fixture.length * 2);
		for (const song of seen) expect(song).not.toHaveProperty("isrc");
	});
});

describe("holds", () => {
	const n = 100;
	const plain = Array.from({ length: n }, (_, i) => MatchCase.parse(pair("plain", `p${i}`)));
	const matchingFirst =
		(count: number): PairwiseFunction =>
		(a) => ({ matched: Number(a.title.slice(1)) < count });
	const recallOf = (fn: PairwiseFunction) =>
		namedFigures(measure(fn, plain)).find((f) => f.name === "recall") as NamedFigure;
	const floor = { recall: 95 / n };

	test("holds a floor exactly at it and falls short just below", () => {
		expect(holds(recallOf(matchingFirst(95)), floor)).toBe(true);
		expect(holds(recallOf(matchingFirst(94)), floor)).toBe(false);
	});

	test("never holds for a figure with no floor set", () => {
		expect(holds(recallOf(matchingFirst(n)), {})).toBe(false);
	});

	test("never holds for a figure with no cases", () => {
		const remix = namedFigures(measure(oracle, plain)).find(
			(f) => f.name === "rejection: remix",
		) as NamedFigure;
		expect(holds(remix, { "rejection: remix": 0 })).toBe(false);
	});

	test("holds the lookalike figure as a ceiling", () => {
		const lookalike = namedFigures(measure(oracle, plain), {
			picksOriginal: { successes: 0, n: 1, rate: 0, interval: undefined },
			picksLookalike: { successes: 1, n: 10, rate: 0.1, interval: undefined },
			lookalikeOnlyPicksNothing: { successes: 0, n: 1, rate: 0, interval: undefined },
		}).find((f) => f.name === "bestMatch: picks the lookalike") as NamedFigure;
		expect(holds(lookalike, { [lookalike.name]: 0.1 })).toBe(true);
		expect(holds(lookalike, { [lookalike.name]: 0.09 })).toBe(false);
	});
});

describe("measureRanking", () => {
	const source = { title: "Strobe", artists: ["deadmau5"], isrc: "GBAAA0000001" };
	const remix = { ...source, title: "Strobe (Remix)" };
	const sets = ([0, 1, 1] as const).map((original) =>
		CandidateSet.parse({
			category: "remix",
			source,
			candidates: original === 0 ? [source, remix] : [remix, source],
			original,
			trap: { a: crypto.randomUUID(), b: crypto.randomUUID() },
		}),
	);
	const first: PickFunction = (_, candidates) => (candidates.length > 0 ? { index: 0 } : undefined);

	test("counts picks of the original and of the lookalike over every set", () => {
		const report = measureRanking(first, sets);
		expect(report.picksOriginal).toMatchObject({ successes: 1, n: 3 });
		expect(report.picksLookalike).toMatchObject({ successes: 2, n: 3 });
	});

	test("offers the lookalike alone, where the right answer is nothing", () => {
		const offered: Song[][] = [];
		const report = measureRanking((_, candidates) => {
			offered.push([...candidates]);
			return undefined;
		}, sets);
		expect(report.lookalikeOnlyPicksNothing).toMatchObject({ successes: 3, n: 3 });
		const alone = offered.filter((candidates) => candidates.length === 1).flat();
		expect(alone.map((song) => song.title)).toEqual(Array(3).fill("Strobe (Remix)"));
	});

	test("hides the ISRC from the function under test", () => {
		const seen: Song[] = [];
		measureRanking((song, candidates) => {
			seen.push(song, ...candidates);
			return undefined;
		}, sets);
		for (const song of seen) expect(song).not.toHaveProperty("isrc");
	});
});

describe("wilson", () => {
	// Worked by hand from the Wilson score formula with z = 1.959964.
	test.each([
		[95, 100, 0.88825, 0.978456],
		[0, 10, 0, 0.277533],
		[10, 10, 0.722467, 1],
		[1, 2, 0.094531, 0.905469],
	])("%i of %i gives [%d, %d]", (successes, n, lower, upper) => {
		const interval = wilson(successes, n);
		expect(interval.lower).toBeCloseTo(lower, 5);
		expect(interval.upper).toBeCloseTo(upper, 5);
	});
});
