import type { Song } from "@ultrasonics/plugin-sdk";
import { type Agreement, agreement, type Field, pairwiseFields } from "./agreement.ts";
import { judge } from "./judgement.ts";
import { isPositive, type MatchCase } from "./match-case.ts";
import { versionMarkersIn } from "./version-marker.ts";

/** Each field's weight per agreement level: log₂ m/u, where m and u are the level's share of matches and non-matches. */
export type Weights = Readonly<Record<Field, Readonly<Record<string, number>>>>;

/** What `scripts/fit-weights.ts` derives from the tuning split and commits as constants. */
export interface Fitted {
	readonly weights: Weights;
	/** The least pairwise weight at which `match` accepts. */
	readonly matchThreshold: number;
	/** The least weight over every field at which `bestMatch` will consider a candidate. */
	readonly mediumThreshold: number;
}

/** The summed weight of `fieldsWeighed`; a level the fit never saw weighs nothing. */
export function weigh(
	agreed: Agreement,
	weights: Weights,
	fieldsWeighed: readonly Field[],
): number {
	return fieldsWeighed.reduce((sum, field) => sum + (weights[field][agreed[field]] ?? 0), 0);
}

/** The weight of a pair after the rules: a hard key is infinitely sure and a veto infinitely not. */
export function weightOf(
	a: Song,
	b: Song,
	weights: Weights,
	fieldsWeighed: readonly Field[],
): number {
	const judgement = judge(a, b);
	if (judgement.kind === "hard") return Number.POSITIVE_INFINITY;
	if (judgement.kind === "veto") return Number.NEGATIVE_INFINITY;
	return weigh(judgement.agreement, weights, fieldsWeighed);
}

const withoutIsrc = ({ isrc: _, ...song }: Song): Song => song;

/**
 * Fits the weights and both thresholds on `tuning`, the MusicBrainz cases of the tuning split.
 * Weights are rounded to three places before the thresholds are fitted, so the committed
 * constants reproduce exactly.
 */
export function fit(tuning: readonly MatchCase[]): Fitted {
	const weights = fitWeights(tuning);
	const scored = (cases: readonly MatchCase[], fieldsWeighed: readonly Field[]) =>
		cases.map((c) => ({
			score: weightOf(withoutIsrc(c.a), withoutIsrc(c.b), weights, fieldsWeighed),
			positive: isPositive(c.category),
		}));
	// The shipped matcher's precision, so the rebuild trades none of it for recall (#132, P1).
	const matchThreshold = lowestAtPrecision(scored(tuning, pairwiseFields), 0.9);
	const band = scored(tuning.filter(inMatchFigure), [...pairwiseFields, "album", "year"]);
	const mediumThreshold = Math.min(highestAtRecall(band, 0.95), lowestAtPrecision(band, 0.99));
	return { weights, matchThreshold, mediumThreshold };
}

/**
 * m from the positives and u from random non-matching pairs, add-half smoothed. u never comes from
 * the traps: they are adversarial by construction, so weights fitted on them learn how the tier
 * was sampled (an equal title counts against a match), not how non-matches look.
 */
function fitWeights(tuning: readonly MatchCase[]): Weights {
	const pairs: [Song, Song, boolean][] = [
		...tuning
			.filter((c) => isPositive(c.category))
			.map((c): [Song, Song, boolean] => [c.a, c.b, true]),
		...randomPairs(tuning).map(([a, b]): [Song, Song, boolean] => [a, b, false]),
	];
	const counts = new Map<Field, Map<string, { m: number; u: number }>>();
	let matches = 0;
	let nonMatches = 0;
	for (const [a, b, positive] of pairs) {
		if (positive) matches++;
		else nonMatches++;
		for (const [field, level] of Object.entries(agreement(a, b)) as [Field, string][]) {
			const byLevel = counts.get(field) ?? new Map();
			counts.set(field, byLevel);
			const count = byLevel.get(level) ?? { m: 0, u: 0 };
			byLevel.set(level, count);
			count[positive ? "m" : "u"]++;
		}
	}
	const round = (x: number) => Math.round(x * 1000) / 1000;
	return Object.fromEntries(
		[...counts].map(([field, byLevel]) => {
			const k = byLevel.size;
			const levels = [...byLevel]
				.sort(([x], [y]) => x.localeCompare(y))
				.map(([level, { m, u }]) => {
					const pm = (m + 0.5) / (matches + 0.5 * k);
					const pu = (u + 0.5) / (nonMatches + 0.5 * k);
					// A field one side lacks is no evidence either way (the Fellegi–Sunter null level).
					return [level, level === "missing" ? 0 : round(Math.log2(pm / pu))];
				});
			return [field, Object.fromEntries(levels)];
		}),
	) as unknown as Weights;
}

/** One case's `a` against the `b` of the cases 1, 7 and 31 places on, never two sides of one recording. */
function randomPairs(cases: readonly MatchCase[]): [Song, Song][] {
	const recordings = cases.flatMap((c) =>
		c.provenance.source === "musicbrainz"
			? [{ c, a: c.provenance.a.recording, b: c.provenance.b.recording }]
			: [],
	);
	const pairs: [Song, Song][] = [];
	for (const shift of [1, 7, 31]) {
		for (const [i, x] of recordings.entries()) {
			const y = recordings[(i + shift) % recordings.length];
			if (y === undefined || x.a === y.b) continue;
			pairs.push([x.c.a, y.c.b]);
		}
	}
	return pairs;
}

/**
 * Unmarked remix and re-recording traps within 3 s are left to ranking (#132), so the medium band
 * is fitted without them.
 */
function inMatchFigure(c: MatchCase): boolean {
	if (c.category !== "remix" && c.category !== "re-recording") return true;
	const marked = versionMarkersIn(c.a.title).size + versionMarkersIn(c.b.title).size > 0;
	const gap =
		c.a.durationMs !== undefined && c.b.durationMs !== undefined
			? Math.abs(c.a.durationMs - c.b.durationMs)
			: 0;
	return marked || gap > 3000;
}

interface Scored {
	readonly score: number;
	readonly positive: boolean;
}

const finiteScores = (scored: readonly Scored[]) =>
	[...new Set(scored.map((s) => s.score).filter(Number.isFinite))].sort((x, y) => x - y);

/** The lowest threshold whose accepted pairs reach `precision`, or the highest score if none does. */
function lowestAtPrecision(scored: readonly Scored[], precision: number): number {
	const thresholds = finiteScores(scored);
	for (const t of thresholds) {
		const accepted = scored.filter((s) => s.score >= t);
		const right = accepted.filter((s) => s.positive).length;
		if (accepted.length > 0 && right / accepted.length >= precision) return t;
	}
	return thresholds.at(-1) ?? 0;
}

/** The highest threshold that still accepts `recall` of the positives, or the lowest score if none does. */
function highestAtRecall(scored: readonly Scored[], recall: number): number {
	const thresholds = finiteScores(scored);
	const positives = scored.filter((s) => s.positive).length;
	for (const t of [...thresholds].reverse()) {
		const found = scored.filter((s) => s.positive && s.score >= t).length;
		if (found / positives >= recall) return t;
	}
	return thresholds[0] ?? 0;
}
