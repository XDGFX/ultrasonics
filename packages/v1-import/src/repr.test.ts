import { describe, expect, test } from "bun:test";
import { parseRepr, ReprError } from "./repr.ts";

describe("parseRepr", () => {
	// Each blob is what Python 3's `repr` writes for the value beside it.
	test.each([
		["single quotes", "'Weekly'", "Weekly"],
		["double quotes when the string holds an apostrophe", `"Don't Stop"`, "Don't Stop"],
		["both quotes in one string", `'Say "hi" don\\'t'`, `Say "hi" don't`],
		["a backslash", "'C:\\\\Music'", "C:\\Music"],
		["newline, return and tab", "'a\\nb\\rc\\td'", "a\nb\rc\td"],
		["a \\x escape", "'bell\\x07'", "bell\u0007"],
		["a \\u escape", "'zero\\u200bwidth'", "zero\u200bwidth"],
		["a \\U escape", "'\\U0001f3b5'", "🎵"],
		["printable non-ASCII as written", "'Café Ñandú 音楽'", "Café Ñandú 音楽"],
		["True", "True", true],
		["False", "False", false],
		["None", "None", null],
		["an integer", "42", 42],
		["a negative float", "-0.5", -0.5],
		["a float with an exponent", "1e-05", 0.00001],
		["an empty dict", "{}", {}],
		["an empty list", "[]", []],
	])("parses %s", (_, blob, expected) => {
		expect(parseRepr(blob)).toEqual(expected);
	});

	test("parses a nested applet blob", () => {
		const blob =
			"{'applet_name': 'Weekly', 'inputs': [{'plugin': 'plex', 'version': '1.0', 'data': {'filter': '^chill', 'n': 3}}], 'triggers': [], 'lastrun': None}";

		expect(parseRepr(blob)).toEqual({
			applet_name: "Weekly",
			inputs: [{ plugin: "plex", version: "1.0", data: { filter: "^chill", n: 3 } }],
			triggers: [],
			lastrun: null,
		});
	});

	test.each([
		["a tuple", "{'a': (1, 2)}", 6],
		["a set", "{'a', 'b'}", 0],
		["datetime(...)", "{'at': datetime(2020, 1, 1)}", 7],
		["a non-string dict key", "{1: 'a'}", 1],
		["an unterminated string", "'abc", 0],
		["trailing text", "'a' 'b'", 4],
		["bytes", "b'abc'", 0],
		["a \\U escape past the last code point", "'\\U00110000'", 1],
	])("rejects %s, naming the offset", (_, blob, offset) => {
		const thrown = (() => {
			try {
				parseRepr(blob);
			} catch (error) {
				return error;
			}
		})();

		expect(thrown).toBeInstanceOf(ReprError);
		expect(thrown).toMatchObject({ offset });
		expect((thrown as Error).message).toContain(`offset ${offset}`);
	});

	test("an error never repeats the text it rejected", () => {
		expect(() => parseRepr("{'token': secret-value}")).toThrow(
			expect.objectContaining({ message: expect.not.stringContaining("secret") }),
		);
	});
});
