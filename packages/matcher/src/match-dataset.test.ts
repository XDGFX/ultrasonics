import { describe, expect, test } from "bun:test";
import { z } from "zod";
import handWrittenJson from "../test/fixtures/match-dataset/hand-written.json";
import musicbrainzJson from "../test/fixtures/match-dataset/musicbrainz.json";
import { isPositive, MatchCase, Rule, trapCategories } from "./match-case.ts";

const handWritten = z.array(MatchCase).parse(handWrittenJson);
const musicbrainz = z.array(MatchCase).parse(musicbrainzJson);

describe("the hand-written cases", () => {
	test("are all marked hand-written, each with its own name", () => {
		const names = handWritten.map((c) =>
			c.provenance.source === "hand-written" ? c.provenance.name : undefined,
		);
		expect(names).not.toContain(undefined);
		expect(new Set(names).size).toBe(names.length);
	});

	test("cover every normalisation rule and every veto", () => {
		const covered = new Set(
			handWritten.flatMap((c) =>
				c.provenance.source === "hand-written" ? c.provenance.covers : [],
			),
		);
		expect([...Rule.options].filter((rule) => !covered.has(rule))).toEqual([]);
	});

	test("include remaster and clean/explicit positives", () => {
		const categories = handWritten.map((c) => c.category);
		expect(categories).toContain("remaster");
		expect(categories).toContain("clean-explicit");
	});
});

describe("the MusicBrainz cases", () => {
	test("have at least 1,000 positive pairs", () => {
		expect(musicbrainz.filter((c) => isPositive(c.category)).length).toBeGreaterThanOrEqual(1000);
	});

	test.each([...trapCategories])("have at least 100 %s pairs", (category) => {
		expect(musicbrainz.filter((c) => c.category === category).length).toBeGreaterThanOrEqual(100);
	});

	test("come from MusicBrainz and hold only its core fields", () => {
		const core = ["title", "artists", "album", "date", "isrc", "durationMs"];
		for (const c of musicbrainzJson) {
			expect(c.provenance.source).toBe("musicbrainz");
			for (const song of [c.a, c.b]) {
				expect(Object.keys(song).filter((key) => !core.includes(key))).toEqual([]);
			}
		}
	});

	test("pair positives that share an ISRC", () => {
		for (const c of musicbrainz.filter((c) => isPositive(c.category))) {
			expect(c.a.isrc).toBeDefined();
			expect(c.a.isrc).toBe(c.b.isrc as string);
		}
	});
});
