import { describe, expect, test } from "bun:test";
import { Song } from "@ultrasonics/plugin-sdk";
import { handWrittenCases, musicbrainzCases } from "./cc0-tier.ts";
import { fitted } from "./fitted-weights.ts";
import { withoutIsrc } from "./judgement.ts";
import { match } from "./match.ts";
import { MatchIndex } from "./match-index.ts";

/** mulberry32: a seeded generator, so a failure reproduces. */
function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Every indexed song `match` accepts against `song`, found by asking it of every pair. */
const everyMatch = (song: Song, indexed: readonly Song[]) =>
	indexed.filter((other) => match(song, other).matched);

/** Asserts the index finds exactly what comparing every pair finds; returns how many pairs matched. */
function expectSameAsEveryPair(indexed: readonly Song[], queries: readonly Song[]): number {
	const index = new MatchIndex();
	index.add(indexed);
	let matched = 0;
	for (const song of queries) {
		const expected = everyMatch(song, indexed);
		expect({ song, found: index.matchesOf(song) }).toEqual({ song, found: expected });
		expect(index.hasMatch(song)).toBe(expected.length > 0);
		matched += expected.length;
	}
	return matched;
}

describe("a match index", () => {
	test("finds exactly the pairs match accepts, on songs built to sit at every boundary", () => {
		const random = seeded(230);
		const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
		const titles = ["Hello", "Night City", "Gold River", "Что", "譚詠麟", "?", "!!", "Love Me Do"];
		const artists = [["Aurora"], ["Bonobo", "Kai"], ["Daughter & Kai"], ["!!!"], ["Земфира"]];
		const window = fitted.lengthWindowMs;
		const offsets = [0, 500, 1000, 1001, window - 1, window, window + 1, 9000, 29_999, 30_001];
		const retitle = (title: string) =>
			pick([
				title,
				title.toUpperCase(),
				title.replace(/[aeiou]/, "a"),
				`${title} Again`,
				`${title} (Remastered)`,
				`${title} (Live)`,
				`${title} - Radio Edit`,
				title.split(" ")[0] ?? title,
			]);
		const original = (): Song =>
			Song.parse({
				title: pick(titles),
				artists: pick(artists),
				durationMs: random() < 0.15 ? undefined : 200_000 + Math.floor(random() * 20_000),
				...(random() < 0.2 ? { isrc: pick(["GB0000000001", "GB0000000002"]) } : {}),
				...(random() < 0.1 ? { location: pick(["file:///a.flac", "file:///b.flac"]) } : {}),
				id: random() < 0.2 ? { deezer: pick(["1", "2", "3"]) } : {},
			});
		const variant = (song: Song): Song =>
			Song.parse({
				...song,
				title: retitle(song.title),
				artists: random() < 0.1 ? [] : random() < 0.2 ? pick(artists) : song.artists,
				durationMs:
					random() < 0.15
						? undefined
						: (song.durationMs ?? 210_000) + pick(offsets) * pick([1, -1]),
			});
		const indexed = Array.from({ length: 400 }, original);
		const queries = Array.from({ length: 400 }, () =>
			random() < 0.7 ? variant(pick(indexed)) : original(),
		);
		expect(expectSameAsEveryPair(indexed, queries)).toBeGreaterThan(1000);
	});

	test("finds exactly the pairs match accepts across the CC0 tier, with and without ISRCs", () => {
		const cases = [...musicbrainzCases, ...handWrittenCases];
		let matched = 0;
		for (let start = 0; start < cases.length; start += 200) {
			const chunk = cases.slice(start, start + 200);
			for (const hide of [(song: Song) => song, withoutIsrc]) {
				matched += expectSameAsEveryPair(
					chunk.map((c) => hide(c.b)),
					chunk.map((c) => hide(c.a)),
				);
			}
		}
		expect(matched).toBeGreaterThan(1000);
	});

	test("searches songs added after it was first searched", () => {
		const song = Song.parse({
			title: "Strobe",
			artists: ["deadmau5"],
			durationMs: 637_000,
			id: {},
		});
		const index = new MatchIndex();
		index.add([]);
		expect(index.hasMatch(song)).toBe(false);
		index.add([song]);
		expect(index.matchesOf(song)).toEqual([song]);
	});
});
