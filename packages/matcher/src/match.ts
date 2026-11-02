import type { Song } from "@ultrasonics/plugin-sdk";
import { artistNames, parseTitle } from "./normalise.ts";
import { byLength, containsWords, opens, similarity } from "./similarity.ts";
import { versionMarkersIn } from "./version-marker.ts";

/** Whether two songs are the same recording, and how sure the matcher is, from 0 to 1. */
export interface MatchResult {
	readonly matched: boolean;
	readonly score: number;
}

/** The widest gap in length two sides of one recording may show. */
export const durationToleranceMs = 3000;

/** The lowest title and artist score at which two songs are the same recording. */
export const threshold = 0.85;

/** The score of a title that opens the other, or an artist credit inside the other, short of an equal one. */
const partScore = 0.9;

const hardMatch: MatchResult = { matched: true, score: 1 };
const noMatch: MatchResult = { matched: false, score: 0 };

/** Whether `a` and `b` are the same recording (spec #117, `match(a, b)`). */
export function match(a: Song, b: Song): MatchResult {
	if (sharesId(a, b)) return hardMatch;
	if (a.location !== undefined && a.location === b.location) return hardMatch;
	if (durationsDisagree(a, b)) return noMatch;
	// Some ISRCs are wrong, so an equal one still answers to the duration veto.
	if (a.isrc !== undefined && a.isrc === b.isrc) return hardMatch;
	// Without artists, a title alone can't tell a song from a stranger's.
	if (a.artists.length === 0 || b.artists.length === 0) return noMatch;
	if (!sameMembers(versionMarkersIn(a.title), versionMarkersIn(b.title))) return noMatch;
	const score = (titleSimilarity(a, b) + artistSimilarity(a, b)) / 2;
	return { matched: score >= threshold, score };
}

function sharesId(a: Song, b: Song): boolean {
	return Object.entries(a.id).some(([space, id]) => b.id[space] === id);
}

function durationsDisagree(a: Song, b: Song): boolean {
	if (a.durationMs === undefined || b.durationMs === undefined) return false;
	return Math.abs(a.durationMs - b.durationMs) > durationToleranceMs;
}

function sameMembers<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
	return a.size === b.size && [...a].every((member) => b.has(member));
}

function titleSimilarity(a: Song, b: Song): number {
	const [left, right] = [parseTitle(a.title).core, parseTitle(b.title).core];
	return Math.max(similarity(left, right), opens(left, right) ? partScore : 0);
}

/** How well the shorter artist list is found in the longer, so a guest on one side only costs nothing. */
function artistSimilarity(a: Song, b: Song): number {
	const [fewer, more] = byLength(artistNames(a.artists), artistNames(b.artists));
	if (fewer.length === 0) return 0;
	const found = fewer.map((name) => Math.max(...more.map((other) => similarity(name, other))));
	const listed = found.reduce((sum, s) => sum + s, 0) / fewer.length;
	return Math.max(listed, containsWords(fewer.join(" "), more.join(" ")) ? partScore : 0);
}
