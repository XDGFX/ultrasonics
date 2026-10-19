import { describe, expect, test } from "bun:test";
import { normaliseDate, normaliseIsrc } from "./normalise.ts";
import { Song } from "./song-dict.ts";

function songWith(field: "isrc" | "date", value: string | undefined) {
	return Song.safeParse({ title: "Strobe", artists: ["deadmau5"], [field]: value });
}

describe("normaliseIsrc", () => {
	test.each([
		["already normalised", "GBAYE0601498"],
		["lower-case", "gbaye0601498"],
		["hyphenated", "GB-AYE-06-01498"],
		["spaced", " GB AYE 06 01498 "],
	])("normalises a %s ISRC", (_, raw) => {
		const result = normaliseIsrc(raw);
		expect(result).toBe("GBAYE0601498");
		expect(songWith("isrc", result).success).toBe(true);
	});

	test.each([
		["blank", "   "],
		["too short", "GBAYE060149"],
		["too long", "GBAYE06014988"],
		["letters in the designation code", "GBAYE06O1498"],
		["a digit in the country code", "G1AYE0601498"],
		["punctuation", "GB.AYE.06.01498"],
	])("gives undefined for a %s ISRC", (_, raw) => {
		expect(normaliseIsrc(raw)).toBeUndefined();
	});
});

describe("normaliseDate", () => {
	test.each<[string, string | number | Date, string]>([
		["a year", "2008", "2008"],
		["a year and month", "2008-09", "2008-09"],
		["a full date", "2008-09-23", "2008-09-23"],
		["a padded string", " 2008-09-23 ", "2008-09-23"],
		["an ISO date-time in UTC", "2008-09-23T14:05:00Z", "2008-09-23"],
		["an ISO date-time with an offset", "2008-09-23T23:30:00-05:00", "2008-09-23"],
		["a year number", 2008, "2008"],
		["a Date", new Date("2008-09-23T14:05:00Z"), "2008-09-23"],
		["a Date late in the UTC day", new Date("2008-09-23T23:59:59Z"), "2008-09-23"],
	])("normalises %s", (_, raw, expected) => {
		const result = normaliseDate(raw);
		expect(result).toBe(expected);
		expect(songWith("date", result).success).toBe(true);
	});

	test.each<[string, string | number | Date]>([
		["an impossible day", "2021-02-30"],
		["an impossible month", "2020-13"],
		["a date-time on an impossible day", "2021-02-30T12:00:00Z"],
		["a blank string", "   "],
		["a day-first date", "23/09/2008"],
		["an unpadded month", "2008-9"],
		["a three-digit year number", 999],
		["a five-digit year number", 10000],
		["a fractional year number", 2008.5],
		["NaN", Number.NaN],
		["an invalid Date", new Date("not a date")],
		["a Date after year 9999", new Date(Date.UTC(10000, 0, 1))],
	])("gives undefined for %s", (_, raw) => {
		expect(normaliseDate(raw)).toBeUndefined();
	});
});
