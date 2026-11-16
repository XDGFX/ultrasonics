import { describe, expect, test } from "bun:test";
import type { Song } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import candidateSetsJson from "../test/fixtures/match-dataset/candidate-sets.json";
import handWrittenJson from "../test/fixtures/match-dataset/hand-written.json";
import musicbrainzJson from "../test/fixtures/match-dataset/musicbrainz.json";
import { candidateSets } from "./cc0-tier.ts";
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

describe("the candidate sets", () => {
	const sets = candidateSets;
	const traps = new Map(
		musicbrainz.flatMap((c) =>
			c.provenance.source === "musicbrainz"
				? [[`${c.provenance.a.recording}|${c.provenance.b.recording}|${c.category}`, c] as const]
				: [],
		),
	);

	test("each come from a lookalike trap in the tier, with its two sides as the candidates", () => {
		for (const set of sets) {
			const trap = traps.get(`${set.trap.a}|${set.trap.b}|${set.category}`);
			expect(trap).toBeDefined();
			expect(set.candidates[set.original]).toEqual(trap?.a as Song);
			expect(set.candidates[1 - set.original]).toEqual(trap?.b as Song);
		}
	});

	test("hold only MusicBrainz core fields in the source", () => {
		const core = ["title", "artists", "album", "date", "isrc", "durationMs"];
		for (const set of candidateSetsJson) {
			expect(Object.keys(set.source).filter((key) => !core.includes(key))).toEqual([]);
		}
	});
});
