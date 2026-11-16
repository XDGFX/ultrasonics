import type { Song } from "@ultrasonics/plugin-sdk";
import anyAscii from "any-ascii";
import { artistNames, normalise, parseTitle } from "./normalise.ts";
import { byLength, containsWords, opens, similarity } from "./similarity.ts";

/**
 * The fields the matcher weighs. `match` weighs the first three; `bestMatch`'s medium band adds
 * album and year, which cost pairwise recall because one recording on two releases differs in
 * both by design (#132).
 */
export const pairwiseFields = ["title", "artist", "length"] as const;
export const fields = [...pairwiseFields, "album", "year"] as const;
export type Field = (typeof fields)[number];

/**
 * How far two songs agree on each field, as discrete levels (Fellegi–Sunter's comparison vector).
 * Similarity levels are lower bounds and length levels upper bounds on the gap; `missing` means
 * one side lacks the field and weighs nothing.
 */
export type Agreement = Record<Field, string>;

/** The widest gap in length two sides of one recording may show; past it, they never match. */
export const lengthVetoMs = 30_000;

/** The score of a title that opens the other, or an artist credit inside the other, short of an equal one. */
const partScore = 0.9;

/** Letters in any script but Latin, read after NFKC, so `Что` and `譚詠麟` count and `é` doesn't. */
const nonLatin = /(?![\p{Script=Latin}])\p{L}/u;

/** Folds every script to ASCII with the any-ascii table, then the matcher's own folding. */
function fold(text: string): string {
	return normalise(anyAscii(text.normalize("NFKC")));
}

/** any-ascii spaces some scripts syllable by syllable, so folded text is compared unspaced. */
const squash = (text: string) => text.replace(/ /g, "");

export function titleSimilarity(a: Song, b: Song): number {
	const [left, right] = [parseTitle(a.title).core, parseTitle(b.title).core];
	const plain = Math.max(similarity(left, right), opens(left, right) ? partScore : 0);
	if (!nonLatin.test(a.title) && !nonLatin.test(b.title)) return plain;
	const [l, r] = [fold(left), fold(right)];
	return Math.max(plain, similarity(squash(l), squash(r)), opens(l, r) ? partScore : 0);
}

/** How well the shorter list is found in the longer, so a guest on one side only costs nothing. */
function listSimilarity(left: readonly string[], right: readonly string[]): number {
	const [fewer, more] = byLength(left, right);
	if (fewer.length === 0) return 0;
	const found = fewer.map((name) => Math.max(...more.map((other) => similarity(name, other))));
	const listed = found.reduce((sum, s) => sum + s, 0) / fewer.length;
	return Math.max(listed, containsWords(fewer.join(" "), more.join(" ")) ? partScore : 0);
}

export function artistSimilarity(a: Song, b: Song): number {
	const plain = listSimilarity(artistNames(a.artists), artistNames(b.artists));
	if (!nonLatin.test(`${a.artists.join(" ")} ${b.artists.join(" ")}`)) return plain;
	const folded = (song: Song) => artistNames(song.artists.map((x) => anyAscii(x))).map(squash);
	return Math.max(plain, listSimilarity(folded(a), folded(b)));
}

export function lengthGapMs(a: Song, b: Song): number | undefined {
	return a.durationMs === undefined || b.durationMs === undefined
		? undefined
		: Math.abs(a.durationMs - b.durationMs);
}

export const yearOf = (date: string | undefined): number | undefined =>
	date === undefined ? undefined : Number(date.slice(0, 4));

const similarityLevel = (s: number) =>
	s >= 0.999 ? "equal" : s >= 0.9 ? "0.9" : s >= 0.75 ? "0.75" : s >= 0.5 ? "0.5" : "below";

function lengthLevel(gap: number | undefined): string {
	if (gap === undefined) return "missing";
	if (gap > lengthVetoMs) return "over";
	return gap <= 1000 ? "1s" : gap <= 3000 ? "3s" : gap <= 10_000 ? "10s" : "30s";
}

function albumLevel(a: Song, b: Song): string {
	if (a.album === undefined || b.album === undefined) return "missing";
	const core = (album: string) => fold(parseTitle(album).core);
	const s = similarity(core(a.album), core(b.album));
	return s >= 0.999 ? "equal" : s >= 0.7 ? "0.7" : "other";
}

function yearLevel(a: Song, b: Song): string {
	const [left, right] = [yearOf(a.date), yearOf(b.date)];
	if (left === undefined || right === undefined) return "missing";
	const gap = Math.abs(left - right);
	return gap === 0 ? "0" : gap <= 2 ? "1-2" : gap <= 9 ? "3-9" : "10+";
}

export function agreement(a: Song, b: Song): Agreement {
	return {
		title: similarityLevel(titleSimilarity(a, b)),
		artist: similarityLevel(artistSimilarity(a, b)),
		length: lengthLevel(lengthGapMs(a, b)),
		album: albumLevel(a, b),
		year: yearLevel(a, b),
	};
}
