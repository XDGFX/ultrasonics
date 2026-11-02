import type { Song } from "@ultrasonics/plugin-sdk";
import {
	type Category,
	isPositive,
	type MatchCase,
	positiveCategories,
	type TrapCategory,
	trapCategories,
} from "./match-case.ts";

/** Any function with `match`'s shape; the harness reads only the decision. */
export type PairwiseFunction = (a: Song, b: Song) => { readonly matched: boolean };

/** The accuracy targets (#104 §5). */
export const targets = { recall: 0.95, rejection: 0.95, precision: 0.99 } as const;

export interface Interval {
	lower: number;
	upper: number;
}

export interface Figure {
	successes: number;
	n: number;
	/** Absent when there are no cases, so an empty category never reads as a pass. */
	rate: number | undefined;
	interval: Interval | undefined;
	target: number;
	met: boolean;
}

export interface Report {
	recall: Figure;
	rejection: Record<TrapCategory, Figure>;
	precision: Figure;
	byCategory: Record<Category, Figure>;
	allMet: boolean;
}

const z = 1.959964;

/** The 95% Wilson score interval, which stays inside [0, 1] for rates near either end. */
export function wilson(successes: number, n: number): Interval {
	const p = successes / n;
	const z2 = z * z;
	const denominator = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denominator;
	const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
	return { lower: Math.max(0, centre - margin), upper: Math.min(1, centre + margin) };
}

function figure(successes: number, n: number, target: number): Figure {
	const rate = n === 0 ? undefined : successes / n;
	return {
		successes,
		n,
		rate,
		interval: n === 0 ? undefined : wilson(successes, n),
		target,
		met: rate !== undefined && rate >= target,
	};
}

function withoutIsrc({ isrc: _, ...song }: Song): Song {
	return song;
}

/** Scores a pairwise function against a tier, hiding each side's ISRC (ADR-0022 §3). */
export function measure(fn: PairwiseFunction, cases: readonly MatchCase[]): Report {
	const outcomes = cases.map((c) => ({
		category: c.category,
		positive: isPositive(c.category),
		matched: fn(withoutIsrc(c.a), withoutIsrc(c.b)).matched,
	}));
	const tally = (category: Category) => {
		const inCategory = outcomes.filter((o) => o.category === category);
		const right = inCategory.filter((o) => o.matched === o.positive).length;
		const target = isPositive(category) ? targets.recall : targets.rejection;
		return figure(right, inCategory.length, target);
	};
	const byCategory = Object.fromEntries(
		[...positiveCategories, ...trapCategories].map((c) => [c, tally(c)]),
	) as Record<Category, Figure>;
	const positives = outcomes.filter((o) => o.positive);
	const predicted = outcomes.filter((o) => o.matched);
	const recall = figure(
		positives.filter((o) => o.matched).length,
		positives.length,
		targets.recall,
	);
	const precision = figure(
		predicted.filter((o) => o.positive).length,
		predicted.length,
		targets.precision,
	);
	const rejection = Object.fromEntries(trapCategories.map((c) => [c, byCategory[c]])) as Record<
		TrapCategory,
		Figure
	>;
	return {
		recall,
		rejection,
		precision,
		byCategory,
		allMet: recall.met && precision.met && Object.values(rejection).every((f) => f.met),
	};
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function line(name: string, f: Figure): string {
	const verdict = f.met ? "met" : "NOT MET";
	if (f.rate === undefined || f.interval === undefined) {
		return `${name.padEnd(28)} no cases (n = 0)      target ${percent(f.target)}  ${verdict}`;
	}
	const interval = `[${percent(f.interval.lower)}, ${percent(f.interval.upper)}]`;
	return `${name.padEnd(28)} ${percent(f.rate).padStart(6)} ${interval.padEnd(16)} n = ${String(f.n).padEnd(5)} target ${percent(f.target)}  ${verdict}`;
}

/** The report as a reader sees it: every figure with its n, 95% interval and verdict. */
export function formatReport(report: Report): string {
	return [
		line("Recall", report.recall),
		...positiveCategories.map((c) => line(`  recall: ${c}`, report.byCategory[c])),
		...trapCategories.map((c) => line(`Rejection: ${c}`, report.rejection[c])),
		line("Precision", report.precision),
		report.allMet ? "Every target met." : "At least one target NOT MET.",
	].join("\n");
}
