import { describe, expect, test } from "bun:test";
import { nameFilter } from "./index.ts";

describe("nameFilter", () => {
	test.each<[string, string, string, boolean]>([
		["* at the start", "*mix", "Party Mix", true],
		["* at the start, with the end differing", "*mix", "Mixed", false],
		["* in the middle", "chill*evening", "Chill Sunday Evening", true],
		["* at the end", "chill*", "Chill Evening", true],
		["* matching nothing", "chill*", "chill", true],
		["? at the start", "?ym", "Gym", true],
		["? in the middle", "g?m", "Gym", true],
		["? at the end", "gy?", "Gym", true],
		["? needing exactly one character", "gy?", "Gy", false],
		["? not matching two characters", "g?m", "Glum", false],
		["? as one astral character", "?", "🎵", true],
		["a plain name matching itself", "Mix", "Mix", true],
		["a plain name not matching a longer name", "Mix", "Remix", false],
		["a plain name not matching a prefix", "Mix", "Mixtape", false],
		["case ignored", "FOCUS", "focus", true],
		["NFC folding, composed pattern", "Café", "Café", true],
		["NFC folding, decomposed pattern", "café", "CAFÉ", true],
		["any pattern in a comma list", " gym ,, *mix ,", "Party Mix", true],
		["no pattern in a comma list", " gym ,, *mix ,", "Focus", false],
		[". as a literal", "a.c", "abc", false],
		[". matching itself", "a.c", "a.c", true],
		["[ as a literal", "[a]", "a", false],
		["[ matching itself", "[a]", "[A]", true],
		["\\ matching itself", "a\\b", "a\\b", true],
		["\\ not escaping the * after it", "a\\*", "a\\xyz", true],
		["\\ needing itself", "a\\b", "ab", false],
	])("%s", (_, patterns, name, expected) => {
		expect(nameFilter(patterns)(name)).toBe(expected);
	});

	test.each(["", "  ", " , ,, "])("a blank list %p matches nothing", (patterns) => {
		const matches = nameFilter(patterns);
		expect(matches("")).toBe(false);
		expect(matches("Gym")).toBe(false);
	});
});
