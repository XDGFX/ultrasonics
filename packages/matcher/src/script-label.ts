import type { Song } from "@ultrasonics/plugin-sdk";

/** Whether a pair's title and artist text is all Latin, shares a non-Latin script, or crosses scripts. */
export const scriptLabels = ["latin", "same-non-latin", "cross-script"] as const;
export type ScriptLabel = (typeof scriptLabels)[number];

const scripts = [
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
].map((name) => ({ name, pattern: new RegExp(`\\p{Script=${name}}`, "u") }));

function scriptsOf(song: Song): Set<string> {
	const found = new Set<string>();
	for (const char of `${song.title} ${song.artists.join(" ")}`.normalize("NFKC")) {
		if (!/\p{L}/u.test(char)) continue;
		for (const { name, pattern } of scripts) if (pattern.test(char)) found.add(name);
	}
	// Japanese mixes kana and kanji in one name, so they count as one script here.
	for (const kana of ["Hiragana", "Katakana"]) if (found.delete(kana)) found.add("Han");
	return found;
}

export function scriptLabel(a: Song, b: Song): ScriptLabel {
	const [left, right] = [scriptsOf(a), scriptsOf(b)];
	const leftNonLatin = [...left].filter((s) => s !== "Latin");
	if (leftNonLatin.length === 0 && [...right].every((s) => s === "Latin")) return "latin";
	return leftNonLatin.some((s) => right.has(s)) ? "same-non-latin" : "cross-script";
}
