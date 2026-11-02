import type { Song } from "@ultrasonics/plugin-sdk";
import { match } from "./match.ts";
import { isRemastered } from "./version-marker.ts";

/** The candidate chosen as the same recording as the song, and where it sat in the list. */
export interface BestMatch {
	readonly candidate: Song;
	readonly index: number;
	readonly score: number;
}

/**
 * The candidate that is the same recording as `song`, or `undefined` when none is, which leaves
 * the song unmatched. Among accepted candidates it prefers the song's own `explicit` flag, then no
 * remaster marker, then the higher score (spec #117, `bestMatch`).
 */
export function bestMatch(song: Song, candidates: readonly Song[]): BestMatch | undefined {
	const rank = ({ candidate, score }: BestMatch) => [
		song.explicit === undefined || candidate.explicit === song.explicit ? 1 : 0,
		isRemastered(candidate.title) ? 0 : 1,
		score,
	];
	let best: { match: BestMatch; rank: number[] } | undefined;
	for (const [index, candidate] of candidates.entries()) {
		const { matched, score } = match(song, candidate);
		if (!matched) continue;
		const accepted = { candidate, index, score };
		const acceptedRank = rank(accepted);
		if (best === undefined || outranks(acceptedRank, best.rank)) {
			best = { match: accepted, rank: acceptedRank };
		}
	}
	return best?.match;
}

function outranks(a: readonly number[], b: readonly number[]): boolean {
	for (const [i, value] of a.entries()) {
		const other = b[i] ?? 0;
		if (value !== other) return value > other;
	}
	return false;
}
