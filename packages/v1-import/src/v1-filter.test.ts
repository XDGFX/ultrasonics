import { describe, expect, test } from "bun:test";
import { convertV1Filter, PLUS_NOTE } from "./v1-filter.ts";

describe("convertV1Filter", () => {
	test.each([
		// pattern, under re.search, under re.match
		["disco", "*disco*", "disco*"],
		["^disco", "disco*", "disco*"],
		["disco$", "*disco", "disco"],
		["^disco$", "disco", "disco"],
		["Mr\\. Brightside \\(Live\\)", "*Mr. Brightside (Live)*", "Mr. Brightside (Live)*"],
		["d.sco", "*d?sco*", "d?sco*"],
		["^chill.*mix$", "chill*mix", "chill*mix"],
		[".*mix", "*mix*", "*mix*"],
		["^a|b$", "a*, *b", "a*, b"],
		["chill|party", "*chill*, *party*", "chill*, party*"],
		["", "*", "*"],
	])("converts %p", (pattern, search, match) => {
		expect(convertV1Filter(pattern, "search")).toEqual({ ok: true, filter: search, notes: [] });
		expect(convertV1Filter(pattern, "match")).toEqual({ ok: true, filter: match, notes: [] });
	});

	test("converts .+ to * and notes that it no longer needs a character", () => {
		expect(convertV1Filter("^a.+z$", "match")).toEqual({
			ok: true,
			filter: "a*z",
			notes: [PLUS_NOTE],
		});
	});

	test.each([
		["a character class", "[Cc]hill"],
		["a group", "(chill)"],
		["another quantifier", "chil+"],
		["an optional character", "colou?r"],
		["a lazy quantifier", "a.*?b"],
		["a class escape", "\\d+"],
		["an anchor mid-branch", "a^b"],
		["a literal * the filter cannot write", "a\\*b"],
		["a literal ? the filter cannot write", "why\\?"],
		["a literal comma", "rock, pop"],
		["a trailing backslash", "a\\"],
		["a branch that only an empty name matches", "^$"],
		["an anchored end with a space the filter would trim", "^chill $"],
	])("needs a manual edit for %s", (_, pattern) => {
		expect(convertV1Filter(pattern, "search")).toMatchObject({ ok: false });
	});
});
