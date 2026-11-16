import type { MatchCase } from "./match-case.ts";

/** Fixes the split, so the weights and the held-out figures can be reproduced (#132). */
export const seed = "132";

/** The share of MusicBrainz cases the weights and thresholds are fitted on; the rest is held out. */
export const tuningShare = 0.4;

/** The recordings and category of a MusicBrainz trap or positive, which decide its side of the split. */
export interface PairKey {
	readonly a: string;
	readonly b: string;
	readonly category: string;
}

/** A number in [0, 1) drawn from the seed and `key`, the same on every run. */
export function draw(key: string): number {
	const digest = new Bun.CryptoHasher("sha1").update(`${seed}|${key}`).digest("hex");
	return Number.parseInt(digest.slice(0, 8), 16) / 2 ** 32;
}

export function inTuningSplit(key: PairKey): boolean {
	return draw(`${key.a}|${key.b}|${key.category}`) < tuningShare;
}

/** A hand-written case has no recordings, so it is always held out. */
export function pairKey(c: MatchCase): PairKey | undefined {
	return c.provenance.source === "musicbrainz"
		? { a: c.provenance.a.recording, b: c.provenance.b.recording, category: c.category }
		: undefined;
}

export function tuningCases(cases: readonly MatchCase[]): MatchCase[] {
	return cases.filter((c) => {
		const key = pairKey(c);
		return key !== undefined && inTuningSplit(key);
	});
}

export function heldOutCases(cases: readonly MatchCase[]): MatchCase[] {
	return cases.filter((c) => {
		const key = pairKey(c);
		return key === undefined || !inTuningSplit(key);
	});
}
