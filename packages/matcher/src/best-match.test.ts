import { describe, expect, test } from "bun:test";
import { Song, type SongInput } from "@ultrasonics/plugin-sdk";
import { bestMatch } from "./best-match.ts";
import { match } from "./match.ts";

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
			score: match(song(), accepted).score,
		});
	});

	test("gives nothing when a candidate is close but none passes match", () => {
		const close = song({ artists: ["deadmau 5"] });
		expect(match(song(), close).matched).toBe(false);
		expect(bestMatch(song(), [close])).toBeUndefined();
	});

	test("once one candidate passes match, a close one on the song's album can win", () => {
		const source = song({ album: "For Lack of a Better Name", date: "2009" });
		const lookalike = song({ album: "Strobe (Remixes)", date: "2009" });
		const original = song({ artists: ["deadmau 5"], album: "For Lack of a Better Name" });
		expect(match(source, original).matched).toBe(false);
		expect(bestMatch(source, [lookalike, original])?.index).toBe(1);
	});

	test("prefers the earliest release when the album doesn't decide", () => {
		const candidates = [song({ date: "2014" }), song({ date: "2009-09-22" })];
		expect(bestMatch(song({ date: "2014" }), candidates)?.index).toBe(1);
	});

	test("ranks an undated candidate after a dated one", () => {
		const candidates = [song(), song({ date: "2014" })];
		expect(bestMatch(song(), candidates)?.index).toBe(1);
	});

	test("prefers the song's album over the earlier release", () => {
		const source = song({ album: "5 Years of mau5" });
		const candidates = [
			song({ album: "For Lack of a Better Name", date: "2009" }),
			song({ album: "5 Years of mau5", date: "2014" }),
		];
		expect(bestMatch(source, candidates)?.index).toBe(1);
	});

	test("prefers a shared id over the song's album", () => {
		const source = song({ album: "5 Years of mau5", id: { spotify: "abc" } });
		const candidates = [song({ album: "5 Years of mau5" }), song({ id: { spotify: "abc" } })];
		expect(bestMatch(source, candidates)?.index).toBe(1);
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
