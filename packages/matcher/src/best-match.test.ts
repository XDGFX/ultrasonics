import { describe, expect, test } from "bun:test";
import { Song, type SongInput } from "@ultrasonics/plugin-sdk";
import { bestMatch } from "./best-match.ts";

const song = (input: Partial<SongInput> = {}) =>
	Song.parse({ title: "Strobe", artists: ["deadmau5"], ...input });

describe("bestMatch", () => {
	test("gives nothing when no candidate is the same recording", () => {
		const candidates = [song({ title: "Some Chords" }), song({ title: "Strobe (Live)" })];
		expect(bestMatch(song(), candidates)).toBeUndefined();
	});

	test("gives nothing for no candidates", () => {
		expect(bestMatch(song(), [])).toBeUndefined();
	});

	test("gives the accepted candidate with its position and score", () => {
		const accepted = song();
		expect(bestMatch(song(), [song({ title: "Some Chords" }), accepted])).toEqual({
			candidate: accepted,
			index: 1,
			score: 1,
		});
	});

	test("prefers the higher score among accepted candidates", () => {
		const candidates = [song({ artists: ["deadmau 5"] }), song()];
		expect(bestMatch(song(), candidates)?.index).toBe(1);
	});

	test("prefers no remaster marker over a higher score", () => {
		const candidates = [
			song({ title: "Strobe - Remastered 2019" }),
			song({ artists: ["deadmau 5"] }),
		];
		expect(bestMatch(song(), candidates)?.index).toBe(1);
	});

	test("prefers the same explicit flag over no remaster marker", () => {
		const candidates = [
			song({ explicit: false }),
			song({ title: "Strobe (2019 Remaster)", explicit: true }),
		];
		expect(bestMatch(song({ explicit: true }), candidates)?.index).toBe(1);
	});

	test("prefers the original even when the song itself is a remaster", () => {
		const candidates = [song({ title: "Strobe - Remastered 2019" }), song()];
		expect(bestMatch(song({ title: "Strobe - Remastered 2019" }), candidates)?.index).toBe(1);
	});

	test("has no explicit preference when the song's own flag is unknown", () => {
		const candidates = [song({ explicit: true }), song({ artists: ["deadmau 5"] })];
		expect(bestMatch(song(), candidates)?.index).toBe(0);
	});

	test("keeps the earlier candidate on a full tie", () => {
		const candidates = [song(), song()];
		expect(bestMatch(song(), candidates)?.index).toBe(0);
	});
});
