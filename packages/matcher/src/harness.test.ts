import { describe, expect, test } from "bun:test";
import type { Song } from "@ultrasonics/plugin-sdk";
import { measure, type PairwiseFunction, targets, wilson } from "./harness.ts";
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

	test("a perfect oracle meets every target", () => {
		const report = measure(oracle, fixture);
		expect(report.recall.met).toBe(true);
		expect(report.precision.met).toBe(true);
		for (const figure of Object.values(report.rejection)) expect(figure.met).toBe(true);
		expect(report.allMet).toBe(true);
	});

	test("always-match misses the rejection and precision targets", () => {
		const report = measure(alwaysMatch, fixture);
		expect(report.rejection.cover.met).toBe(false);
		expect(report.precision.met).toBe(false);
		expect(report.allMet).toBe(false);
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

	test("marks a figure with no cases not met, and gives it no rate", () => {
		const report = measure(
			oracle,
			fixture.filter((c) => c.category !== "remix"),
		);
		expect(report.rejection.remix).toMatchObject({ n: 0, rate: undefined, met: false });
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

	test("meets a target exactly at it and misses it just below", () => {
		const n = 100;
		const plain = Array.from({ length: n }, (_, i) => MatchCase.parse(pair("plain", `p${i}`)));
		const matchingFirst =
			(count: number): PairwiseFunction =>
			(a) => ({
				matched: Number(a.title.slice(1)) < count,
			});
		expect(measure(matchingFirst(targets.recall * n), plain).recall.met).toBe(true);
		expect(measure(matchingFirst(targets.recall * n - 1), plain).recall.met).toBe(false);
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
