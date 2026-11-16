import type { Song } from "@ultrasonics/plugin-sdk";
import { fields, yearOf } from "./agreement.ts";
import { weightOf } from "./fellegi-sunter.ts";
import { fitted } from "./fitted-weights.ts";
import { match } from "./match.ts";
import { normaliseName } from "./normalise.ts";
import { isRemastered } from "./version-marker.ts";

/** The candidate chosen as the same recording as the song, and where it sat in the list. */
export interface BestMatch {
	readonly candidate: Song;
	readonly index: number;
	/** `match`'s score for the song and this candidate. */
	readonly score: number;
}

/**
 * The candidate that is the same recording as `song`, or `undefined` when none is, which leaves
 * the song unmatched (spec #132, H1). `match` decides whether there is a match at all. The choice
 * is then among every candidate in the wider medium band, so a near-miss original can beat a
 * lookalike that passed alone. It prefers a hard key, then the song's own `explicit` flag, then
 * no remaster marker, then the song's album, then the earliest release, then the higher weight,
 * then the earlier position.
 */
export function bestMatch(song: Song, candidates: readonly Song[]): BestMatch | undefined {
	if (!candidates.some((candidate) => match(song, candidate).matched)) return undefined;
	let best: { index: number; rank: number[] } | undefined;
	for (const [index, candidate] of candidates.entries()) {
		const weight = weightOf(song, candidate, fitted.weights, fields);
		if (weight < fitted.mediumThreshold) continue;
		const rank = [
			weight === Number.POSITIVE_INFINITY ? 1 : 0,
			song.explicit === undefined || candidate.explicit === song.explicit ? 1 : 0,
			isRemastered(candidate.title) ? 0 : 1,
			sameAlbum(song, candidate) ? 1 : 0,
			-(yearOf(candidate.date) ?? Number.POSITIVE_INFINITY),
			weight,
		];
		if (best === undefined || outranks(rank, best.rank)) best = { index, rank };
	}
	if (best === undefined) return undefined;
	const candidate = candidates[best.index] as Song;
	return { candidate, index: best.index, score: match(song, candidate).score };
}

const sameAlbum = (song: Song, candidate: Song) =>
	song.album !== undefined &&
	candidate.album !== undefined &&
	normaliseName(song.album) === normaliseName(candidate.album);

/** Compares ranks in order; a full tie keeps the earlier candidate. */
function outranks(a: readonly number[], b: readonly number[]): boolean {
	for (const [i, value] of a.entries()) {
		const other = b[i] ?? 0;
		if (value !== other) return value > other;
	}
	return false;
}
