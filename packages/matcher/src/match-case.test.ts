import { describe, expect, test } from "bun:test";
import { MatchCase } from "./match-case.ts";

const song = { title: "Strobe", artists: ["deadmau5"], durationMs: 637000 };

const handWritten = {
	a: song,
	b: { ...song, title: "Strobe (Radio Edit)", durationMs: 200000 },
	label: "no-match",
	category: "edit",
	provenance: { source: "hand-written", name: "a radio edit", covers: ["edit-marker"] },
};

describe("MatchCase", () => {
	test("parses a hand-written case", () => {
		expect(MatchCase.parse(handWritten).category).toBe("edit");
	});

	test("parses a MusicBrainz case with each side's ISRC and recording", () => {
		const parsed = MatchCase.parse({
			...handWritten,
			label: "match",
			category: "plain",
			b: song,
			provenance: {
				source: "musicbrainz",
				a: { isrc: "GBAAA0000001", recording: "dfa9ec77-2eb1-4149-8427-739f5aa09f4b" },
				b: { isrc: "GBAAA0000001", recording: "dfa9ec77-2eb1-4149-8427-739f5aa09f4b" },
			},
		});
		expect(parsed.provenance.source).toBe("musicbrainz");
	});

	test.each([
		["an id", { id: { spotify: "abc" } }],
		["a location", { location: "file:///music/strobe.flac" }],
	])("rejects a song with %s", (_, extra) => {
		expect(MatchCase.safeParse({ ...handWritten, b: { ...song, ...extra } }).success).toBe(false);
	});

	test.each([
		["a positive category labelled no-match", "remaster", "no-match"],
		["a trap category labelled match", "live", "match"],
	])("rejects %s", (_, category, label) => {
		expect(MatchCase.safeParse({ ...handWritten, category, label }).success).toBe(false);
	});

	test("rejects a hand-written case that covers no rule", () => {
		const provenance = { source: "hand-written", name: "nothing", covers: [] };
		expect(MatchCase.safeParse({ ...handWritten, provenance }).success).toBe(false);
	});
});
