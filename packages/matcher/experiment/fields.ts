/**
 * Experiment for #132, not shipped: the per-field comparisons a rebuilt matcher scores. Each
 * comparison returns a similarity in [0, 1] (or `undefined` when a side lacks the field) and a
 * discrete agreement level for Fellegi–Sunter weighting.
 */
import type { Song } from "@ultrasonics/plugin-sdk";
import anyAscii from "any-ascii";
import { artistNames, normalise, parseTitle } from "../src/normalise.ts";
import { byLength, containsWords, opens, similarity } from "../src/similarity.ts";

const partScore = 0.9;

/** Letters in any script but Latin, read after NFKC, so `Что` and `譚詠麟` count and `é` doesn't. */
const nonLatin = /(?![\p{Script=Latin}])\p{L}/u;

export type ScriptLabel = "latin" | "same-non-latin" | "cross-script";

const scriptsOf = (text: string): Set<string> => {
	const found = new Set<string>();
	for (const char of text.normalize("NFKC")) {
		if (!/\p{L}/u.test(char)) continue;
		for (const script of [
			"Latin",
			"Cyrillic",
			"Greek",
			"Han",
			"Hiragana",
			"Katakana",
			"Hangul",
			"Arabic",
			"Hebrew",
			"Thai",
			"Devanagari",
		]) {
			if (new RegExp(`\\p{Script=${script}}`, "u").test(char)) found.add(script);
		}
	}
	// Japanese mixes kana and kanji in one name, so they count as one script here.
	for (const s of ["Hiragana", "Katakana"]) if (found.delete(s)) found.add("Han");
	return found;
};

/** Whether the pair's title and artist text is all Latin, shares a non-Latin script, or crosses scripts. */
export function scriptLabel(a: Song, b: Song): ScriptLabel {
	const left = scriptsOf(`${a.title} ${a.artists.join(" ")}`);
	const right = scriptsOf(`${b.title} ${b.artists.join(" ")}`);
	const nonLatinLeft = [...left].filter((s) => s !== "Latin");
	const nonLatinRight = [...right].filter((s) => s !== "Latin");
	if (nonLatinLeft.length === 0 && nonLatinRight.length === 0) return "latin";
	const shared = nonLatinLeft.some((s) => right.has(s));
	return shared ? "same-non-latin" : "cross-script";
}

/** Folds every script to ASCII with the any-ascii table (ISC), then the matcher's own folding. */
export function fold(text: string): string {
	return normalise(anyAscii(text.normalize("NFKC")));
}

const squash = (text: string) => text.replace(/ /g, "");

export interface FieldOptions {
	readonly transliterate: boolean;
}

/** The baseline title similarity, and with transliteration the best of it and a folded, unspaced one. */
export function titleSimilarity(a: Song, b: Song, o: FieldOptions): number {
	const [left, right] = [parseTitle(a.title).core, parseTitle(b.title).core];
	const plain = Math.max(similarity(left, right), opens(left, right) ? partScore : 0);
	if (!o.transliterate || !(nonLatin.test(a.title) || nonLatin.test(b.title))) return plain;
	const [l, r] = [fold(parseTitle(a.title).core), fold(parseTitle(b.title).core)];
	return Math.max(plain, similarity(squash(l), squash(r)), opens(l, r) ? partScore : 0);
}

function listSimilarity(left: readonly string[], right: readonly string[]): number {
	const [fewer, more] = byLength(left, right);
	if (fewer.length === 0) return 0;
	const found = fewer.map((name) => Math.max(...more.map((other) => similarity(name, other))));
	const listed = found.reduce((sum, s) => sum + s, 0) / fewer.length;
	return Math.max(listed, containsWords(fewer.join(" "), more.join(" ")) ? partScore : 0);
}

export function artistSimilarity(a: Song, b: Song, o: FieldOptions): number {
	const plain = listSimilarity(artistNames(a.artists), artistNames(b.artists));
	const raw = `${a.artists.join(" ")} ${b.artists.join(" ")}`;
	if (!o.transliterate || !nonLatin.test(raw)) return plain;
	const folded = (song: Song) => artistNames(song.artists.map((x) => anyAscii(x))).map(squash);
	return Math.max(plain, listSimilarity(folded(a), folded(b)));
}

export function albumSimilarity(a: Song, b: Song, o: FieldOptions): number | undefined {
	if (!a.album || !b.album) return undefined;
	const core = (s: string) => (o.transliterate ? fold(parseTitle(s).core) : parseTitle(s).core);
	return similarity(core(a.album), core(b.album));
}

export const lengthGapMs = (a: Song, b: Song): number | undefined =>
	a.durationMs === undefined || b.durationMs === undefined
		? undefined
		: Math.abs(a.durationMs - b.durationMs);

export const yearOf = (date: string | undefined): number | undefined =>
	date === undefined ? undefined : Number(date.slice(0, 4));

export const yearGap = (a: Song, b: Song): number | undefined => {
	const [l, r] = [yearOf(a.date), yearOf(b.date)];
	return l === undefined || r === undefined ? undefined : Math.abs(l - r);
};

/** An ISRC's two-digit year of reference as a full year: the year it was assigned (IFPI handbook §3.3.3). */
export function isrcYear(isrc: string): number {
	const yy = Number(isrc.slice(5, 7));
	return yy >= 40 ? 1900 + yy : 2000 + yy;
}

/** The prefix code: country plus registrant, the first five characters. */
export const isrcRegistrant = (isrc: string) => isrc.slice(0, 5);

/** Discrete agreement levels, the comparison vectors Fellegi–Sunter weights. */
export function levels(a: Song, b: Song, o: FieldOptions & { readonly isrc: boolean }) {
	const t = titleSimilarity(a, b, o);
	const ar = artistSimilarity(a, b, o);
	const al = albumSimilarity(a, b, o);
	const len = lengthGapMs(a, b);
	const yg = yearGap(a, b);
	const level: Record<string, string> = {
		title:
			t >= 0.999 ? "equal" : t >= 0.9 ? "≥0.9" : t >= 0.75 ? "≥0.75" : t >= 0.5 ? "≥0.5" : "<0.5",
		artist:
			ar >= 0.999
				? "equal"
				: ar >= 0.9
					? "≥0.9"
					: ar >= 0.75
						? "≥0.75"
						: ar >= 0.5
							? "≥0.5"
							: "<0.5",
		album: al === undefined ? "missing" : al >= 0.999 ? "equal" : al >= 0.7 ? "≥0.7" : "other",
		length:
			len === undefined
				? "missing"
				: len <= 1000
					? "≤1s"
					: len <= 3000
						? "≤3s"
						: len <= 10_000
							? "≤10s"
							: len <= 30_000
								? "≤30s"
								: ">30s",
		year: yg === undefined ? "missing" : yg === 0 ? "0" : yg <= 2 ? "1–2" : yg <= 9 ? "3–9" : "≥10",
	};
	if (o.isrc) {
		if (a.isrc === undefined || b.isrc === undefined) level.isrc = "missing";
		else if (a.isrc === b.isrc) level.isrc = "equal";
		else {
			const gap = Math.abs(isrcYear(a.isrc) - isrcYear(b.isrc));
			const registrant =
				isrcRegistrant(a.isrc) === isrcRegistrant(b.isrc) ? "same-reg" : "other-reg";
			level.isrc = `${registrant}/${gap <= 1 ? "≤1y" : gap <= 4 ? "2–4y" : "≥5y"}`;
		}
	}
	return { level, sims: { title: t, artist: ar, album: al, lengthGapMs: len, yearGap: yg } };
}
