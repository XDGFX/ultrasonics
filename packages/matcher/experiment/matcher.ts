/**
 * Experiment for #132, not shipped: one configurable matcher, so each technique the spec proposes
 * can be switched on alone or with others and measured. The hard keys, the version-marker veto and
 * the empty-artist rule are the shipped matcher's, unchanged, in every variant.
 */
import type { Song } from "@ultrasonics/plugin-sdk";
import { parseTitle } from "../src/normalise.ts";
import { versionMarkersIn } from "../src/version-marker.ts";
import { type FieldOptions, levels } from "./fields.ts";

export type Band = "strong" | "medium" | "none";

export interface Verdict {
	readonly band: Band;
	readonly score: number;
}

export type LengthRule =
	/** The shipped rule: a hard veto past the tolerance. */
	| { readonly kind: "cliff"; readonly toleranceMs: number }
	/** beets' rule (`track_length_grace`, `track_length_max`), plus a far veto. */
	| {
			readonly kind: "grace";
			readonly graceMs: number;
			readonly maxMs: number;
			readonly vetoMs: number;
	  };

/** Per-field Fellegi–Sunter weights: log2(m/u) for each agreement level of each field. */
export type FsWeights = Record<string, Record<string, number>>;

export type Scoring =
	/** The shipped score: mean of title and artist similarity against one threshold. */
	| { readonly kind: "mean"; readonly threshold: number }
	/** beets-style weighted distance, 0 = equal, banded into strong and medium. */
	| {
			readonly kind: "weighted";
			readonly weights: Readonly<Record<"title" | "artist" | "length" | "album" | "year", number>>;
			readonly strong: number;
			readonly medium: number;
	  }
	/** Fellegi–Sunter: the sum of the fields' log2 likelihood ratios, banded by two thresholds. */
	| {
			readonly kind: "fs";
			readonly weights: FsWeights;
			readonly strong: number;
			readonly medium: number;
			readonly titleFrequency?: ReadonlyMap<string, number>;
	  };

export interface Variant {
	readonly name: string;
	readonly transliterate: boolean;
	readonly length: LengthRule;
	readonly scoring: Scoring;
	/** Use a different ISRC as evidence (only when ISRCs reach the matcher). */
	readonly isrcEvidence: boolean;
	/** Whether a medium band counts as a match for the pairwise figures. */
	readonly acceptMedium: boolean;
}

const hard: Verdict = { band: "strong", score: Number.POSITIVE_INFINITY };
const none: Verdict = { band: "none", score: Number.NEGATIVE_INFINITY };

function sameMembers<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
	return a.size === b.size && [...a].every((member) => b.has(member));
}

const farVetoMs = (rule: LengthRule) => (rule.kind === "cliff" ? rule.toleranceMs : rule.vetoMs);

export function verdict(v: Variant, a: Song, b: Song): Verdict {
	if (Object.entries(a.id).some(([space, id]) => b.id[space] === id)) return hard;
	if (a.location !== undefined && a.location === b.location) return hard;
	const gap =
		a.durationMs === undefined || b.durationMs === undefined
			? undefined
			: Math.abs(a.durationMs - b.durationMs);
	if (gap !== undefined && gap > farVetoMs(v.length)) return none;
	if (a.isrc !== undefined && a.isrc === b.isrc) return hard;
	if (a.artists.length === 0 || b.artists.length === 0) return none;
	if (!sameMembers(versionMarkersIn(a.title), versionMarkersIn(b.title))) return none;

	const o: FieldOptions & { isrc: boolean } = {
		transliterate: v.transliterate,
		isrc: v.isrcEvidence,
	};
	const { level, sims } = levels(a, b, o);
	const s = v.scoring;

	if (s.kind === "mean") {
		const score = (sims.title + sims.artist) / 2;
		return { band: score >= s.threshold ? "strong" : "none", score };
	}

	if (s.kind === "weighted") {
		const parts: [number, number][] = [
			[s.weights.title, 1 - sims.title],
			[s.weights.artist, 1 - sims.artist],
		];
		if (gap !== undefined) parts.push([s.weights.length, lengthPenalty(v.length, gap)]);
		if (sims.album !== undefined) parts.push([s.weights.album, 1 - sims.album]);
		if (sims.yearGap !== undefined) parts.push([s.weights.year, Math.min(sims.yearGap, 10) / 10]);
		const total = parts.reduce((sum, [w]) => sum + w, 0);
		const distance = parts.reduce((sum, [w, d]) => sum + w * d, 0) / total;
		const band = distance <= s.strong ? "strong" : distance <= s.medium ? "medium" : "none";
		return { band, score: -distance };
	}

	let score = 0;
	for (const [field, value] of Object.entries(level)) score += s.weights[field]?.[value] ?? 0;
	if (s.titleFrequency !== undefined && level.title === "equal") {
		score += termFrequencyAdjustment(s, a);
	}
	const band = score >= s.strong ? "strong" : score >= s.medium ? "medium" : "none";
	return { band, score };
}

/** beets' `track_distance` length term: nothing inside the grace, then linear to 1 at grace + max. */
export function lengthPenalty(rule: LengthRule, gap: number | undefined): number {
	if (gap === undefined || rule.kind === "cliff") return 0;
	return Math.min(Math.max(gap - rule.graceMs, 0), rule.maxMs) / rule.maxMs;
}

/**
 * Splink's term-frequency adjustment on an exact title agreement: log2(u_level / tf(title)), so a
 * rare title earns more than the level's average and a common one ("Intro") less.
 */
function termFrequencyAdjustment(s: Extract<Scoring, { kind: "fs" }>, a: Song): number {
	const frequency = s.titleFrequency;
	if (frequency === undefined) return 0;
	const key = levelsKey(a.title);
	const tf = Math.max(frequency.get(key) ?? 0, frequency.get("__floor__") ?? 0.001);
	const uLevel = frequency.get("__u_equal__") ?? tf;
	return Math.log2(uLevel / tf);
}

export const levelsKey = (title: string) => parseTitle(title).core;

export const matches = (v: Variant, a: Song, b: Song): boolean => {
	const { band } = verdict(v, a, b);
	return band === "strong" || (v.acceptMedium && band === "medium");
};
