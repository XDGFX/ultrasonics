import { describe, expect, test } from "bun:test";
import dateCases from "../test/fixtures/normalise/date.json";
import isrcCases from "../test/fixtures/normalise/isrc.json";
import { normaliseDate, normaliseIsrc, Song } from "./index.ts";

function songWith(field: "isrc" | "date", value: string | undefined) {
	return Song.parse({ title: "Strobe", artists: ["deadmau5"], [field]: value });
}

describe("normaliseIsrc", () => {
	test.each(isrcCases.normalised)("normalises a %s ISRC", (_, raw, expected) => {
		expect(normaliseIsrc(raw)).toBe(expected);
	});

	test.each(isrcCases.normalised)("gives a song ISRC for a %s ISRC", (_, raw) => {
		const isrc = normaliseIsrc(raw);
		expect(songWith("isrc", isrc)).toHaveProperty("isrc", isrc);
	});

	test.each(isrcCases.rejected)("gives undefined for a %s ISRC", (_, raw) => {
		expect(normaliseIsrc(raw)).toBeUndefined();
	});
});

describe("normaliseDate", () => {
	// JSON holds neither a Date nor NaN, so these cases stay here.
	const nonJsonNormalised: [string, Date, string][] = [
		["a Date", new Date("2008-09-23T14:05:00Z"), "2008-09-23"],
		["a Date late in the UTC day", new Date("2008-09-23T23:59:59Z"), "2008-09-23"],
	];
	const nonJsonRejected: [string, number | Date][] = [
		["NaN", Number.NaN],
		["an invalid Date", new Date("not a date")],
		["a Date after year 9999", new Date(Date.UTC(10000, 0, 1))],
	];

	test.each<[string, string | number | Date, string]>([
		...(dateCases.normalised as [string, string | number, string][]),
		...nonJsonNormalised,
	])("normalises %s", (_, raw, expected) => {
		expect(normaliseDate(raw)).toBe(expected);
	});

	test.each(dateCases.normalised)("gives a song date for %s", (_, raw) => {
		const date = normaliseDate(raw);
		expect(songWith("date", date)).toHaveProperty("date", date);
	});

	test.each<[string, string | number | Date]>([
		...(dateCases.rejected as [string, string | number][]),
		...nonJsonRejected,
	])("gives undefined for %s", (_, raw) => {
		expect(normaliseDate(raw)).toBeUndefined();
	});
});
