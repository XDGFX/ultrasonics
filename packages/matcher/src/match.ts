import type { Song } from "@ultrasonics/plugin-sdk";
import { pairwiseFields } from "./agreement.ts";
import { weightOf } from "./fellegi-sunter.ts";
import { fitted } from "./fitted-weights.ts";

/** Whether two songs are the same recording, and how sure the matcher is, from 0 to 1. */
export interface MatchResult {
	readonly matched: boolean;
	/**
	 * 1 / (1 + 2^(threshold − weight)): 0.5 at the threshold, so a match scores at least 0.5;
	 * 1 for a hard key and 0 for a veto.
	 */
	readonly score: number;
}

/**
 * Whether `a` and `b` are the same recording (spec #132, P1): a hard key or a veto decides
 * outright; otherwise title, artist and length agreement are weighed against a fitted threshold.
 */
export function match(a: Song, b: Song): MatchResult {
	const weight = weightOf(a, b, fitted.weights, pairwiseFields);
	return {
		matched: weight >= fitted.matchThreshold,
		score: 1 / (1 + 2 ** (fitted.matchThreshold - weight)),
	};
}
