import type { Song } from "@ultrasonics/plugin-sdk";
import type { CandidateSet } from "./candidate-set.ts";
import { withoutIsrc } from "./judgement.ts";
import {
	type Category,
	isPositive,
	type MatchCase,
	positiveCategories,
	type TrapCategory,
	trapCategories,
} from "./match-case.ts";
import { type ScriptLabel, scriptLabel, scriptLabels } from "./script-label.ts";

/** Any function with `match`'s shape; the harness reads only the decision. */
export type PairwiseFunction = (a: Song, b: Song) => { readonly matched: boolean };

/** Any function with `bestMatch`'s shape; the harness reads only the chosen position. */
export type PickFunction = (
	song: Song,
	candidates: readonly Song[],
) => { readonly index: number } | undefined;

export interface Interval {
	lower: number;
	upper: number;
}

export interface Figure {
	successes: number;
	n: number;
	/** Absent when there are no cases, so an empty category never reads as holding its floor. */
	rate: number | undefined;
	interval: Interval | undefined;
}

export interface Report {
	recall: Figure;
	rejection: Record<TrapCategory, Figure>;
	precision: Figure;
	byCategory: Record<Category, Figure>;
	byScript: Record<ScriptLabel, Figure>;
}

/** `bestMatch` on candidate sets (#132): how often it picks the original, and the lookalike. */
export interface RankingReport {
	picksOriginal: Figure;
	picksLookalike: Figure;
	/** With only the lookalike offered, the right answer is nothing. */
	lookalikeOnlyPicksNothing: Figure;
}

const z95 = 1.959964;

/** The 95% Wilson score interval, which stays inside [0, 1] for rates near either end. */
export function wilson(successes: number, n: number): Interval {
	const p = successes / n;
	const z2 = z95 * z95;
	const denominator = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denominator;
	const margin = (z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
	return { lower: Math.max(0, centre - margin), upper: Math.min(1, centre + margin) };
}

function figure(successes: number, n: number): Figure {
	return {
		successes,
		n,
		rate: n === 0 ? undefined : successes / n,
		interval: n === 0 ? undefined : wilson(successes, n),
	};
}

/** Scores a pairwise function against a tier, hiding each side's ISRC (ADR-0022 §3). */
export function measure(fn: PairwiseFunction, cases: readonly MatchCase[]): Report {
	const outcomes = cases.map((c) => ({
		category: c.category,
		script: scriptLabel(c.a, c.b),
		positive: isPositive(c.category),
		matched: fn(withoutIsrc(c.a), withoutIsrc(c.b)).matched,
	}));
	const tally = (selected: typeof outcomes) =>
		figure(selected.filter((o) => o.matched === o.positive).length, selected.length);
	const byCategory = Object.fromEntries(
		[...positiveCategories, ...trapCategories].map((c) => [
			c,
			tally(outcomes.filter((o) => o.category === c)),
		]),
	) as Record<Category, Figure>;
	const positives = outcomes.filter((o) => o.positive);
	const predicted = outcomes.filter((o) => o.matched);
	return {
		recall: tally(positives),
		rejection: Object.fromEntries(trapCategories.map((c) => [c, byCategory[c]])) as Record<
			TrapCategory,
			Figure
		>,
		precision: figure(predicted.filter((o) => o.positive).length, predicted.length),
		byCategory,
		byScript: Object.fromEntries(
			scriptLabels.map((s) => [s, tally(positives.filter((o) => o.script === s))]),
		) as Record<ScriptLabel, Figure>,
	};
}

/** Scores a pick function against candidate sets, hiding every ISRC. */
export function measureRanking(pick: PickFunction, sets: readonly CandidateSet[]): RankingReport {
	const picks = sets.map((set) => ({
		set,
		index: pick(withoutIsrc(set.source), set.candidates.map(withoutIsrc))?.index,
	}));
	const alone = sets.map((set) =>
		pick(withoutIsrc(set.source), [withoutIsrc(set.candidates[1 - set.original] as Song)]),
	);
	return {
		picksOriginal: figure(picks.filter((p) => p.index === p.set.original).length, sets.length),
		picksLookalike: figure(
			picks.filter((p) => p.index !== undefined && p.index !== p.set.original).length,
			sets.length,
		),
		lookalikeOnlyPicksNothing: figure(alone.filter((p) => p === undefined).length, sets.length),
	};
}

/** A figure by name, and whether a higher rate is better (every one but picking the lookalike). */
export interface NamedFigure {
	readonly name: string;
	readonly figure: Figure;
	readonly higherIsBetter: boolean;
}

export function namedFigures(report: Report, ranking?: RankingReport): NamedFigure[] {
	const named = (name: string, f: Figure, higherIsBetter = true) => ({
		name,
		figure: f,
		higherIsBetter,
	});
	return [
		named("recall", report.recall),
		...positiveCategories.map((c) => named(`recall: ${c}`, report.byCategory[c])),
		...scriptLabels.map((s) => named(`recall: ${s}`, report.byScript[s])),
		...trapCategories.map((c) => named(`rejection: ${c}`, report.rejection[c])),
		named("precision", report.precision),
		...(ranking === undefined
			? []
			: [
					named("bestMatch: picks the original", ranking.picksOriginal),
					named("bestMatch: picks the lookalike", ranking.picksLookalike, false),
					named("bestMatch, lookalike only: picks nothing", ranking.lookalikeOnlyPicksNothing),
				]),
	];
}

/** A rate per figure name that later changes may not regress (#132). */
export type Floor = Readonly<Record<string, number>>;

/** Whether the figure holds its floor; a figure with no cases, or none set, never does. */
export function holds({ name, figure: f, higherIsBetter }: NamedFigure, floor: Floor): boolean {
	const limit = floor[name];
	if (f.rate === undefined || limit === undefined) return false;
	return higherIsBetter ? f.rate >= limit : f.rate <= limit;
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

function line(f: NamedFigure, floor: Floor | undefined): string {
	const name = f.name.padEnd(42);
	const { rate, interval, n } = f.figure;
	if (rate === undefined || interval === undefined) return `${name} no cases (n = 0)`;
	const range = `[${percent(interval.lower)}, ${percent(interval.upper)}]`;
	const figureText = `${name} ${percent(rate).padStart(6)} ${range.padEnd(16)} n = ${String(n).padEnd(5)}`;
	const limit = floor?.[f.name];
	if (floor === undefined) return figureText;
	if (limit === undefined) return `${figureText} no floor set`;
	const bound = `${f.higherIsBetter ? "floor" : "ceiling"} ${percent(limit)}`;
	return `${figureText} ${bound}  ${holds(f, floor) ? "holds" : "BELOW FLOOR"}`;
}

/** The report as a reader sees it: every figure with its n, 95% interval and, given a floor, its verdict. */
export function formatReport(report: Report, ranking?: RankingReport, floor?: Floor): string {
	return namedFigures(report, ranking)
		.map((f) => line(f, floor))
		.join("\n");
}
