import { expect, test } from "bun:test";
import { lengthVetoMs, match } from "@ultrasonics/matcher";
import { type Song, SongDict, type SongInput } from "@ultrasonics/plugin-sdk";
import { merge } from "./test-support.ts";

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

const random = seeded(186);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const words = ["night", "city", "gold", "river", "fire", "light", "home", "wild", "blue", "rain"];
const isrcs = ["GBAAA0000001", "GBAAA0000002", "GBAAA0000003", "GBAAA0000004"];

function original(): SongInput {
	return {
		title: `${pick(words)} ${pick(words)}`,
		artists: [pick(["Aurora", "Bonobo", "Caribou", "Daughter"])],
		durationMs: random() < 0.15 ? undefined : 200_000 + Math.floor(random() * 60_000),
		...(random() < 0.3 ? { isrc: pick(isrcs) } : {}),
		id: {},
	};
}

/** A song near `song`: lengths either side of the veto, a missing length, a dropped artist. */
function variant(song: SongInput): SongInput {
	const offsets = [0, 900, 2_500, 9_000, lengthVetoMs - 1, lengthVetoMs, lengthVetoMs + 1, 45_000];
	const length =
		random() < 0.15 ? undefined : (song.durationMs ?? 210_000) + pick(offsets) * pick([1, -1]);
	return {
		...song,
		title: random() < 0.2 ? `${song.title} ${pick(words)}` : song.title,
		artists: random() < 0.1 ? [] : song.artists,
		durationMs: length,
		isrc: random() < 0.3 ? pick(isrcs) : song.isrc,
	};
}

test("the merge drops exactly the later songs that match accepts against an earlier playlist", async () => {
	const first = Array.from({ length: 150 }, original);
	const source = (count: number) =>
		Array.from({ length: count }, () => (random() < 0.7 ? variant(pick(first)) : original()));
	const group = [first, source(150), source(150)].map((songs) => ({ name: "Mix", id: {}, songs }));
	const parsed = SongDict.parse({ playlists: group }).playlists;

	// The oracle: every later song against every song of every earlier playlist, with no blocking.
	const expected: Song[] = [];
	parsed.forEach((playlist, index) => {
		const earlier = parsed.slice(0, index).flatMap((p) => p.songs);
		for (const song of playlist.songs) {
			if (index === 0 || !earlier.some((other) => match(song, other).matched)) expected.push(song);
		}
	});
	const dropped = parsed.flatMap((p) => p.songs).length - expected.length;
	expect(dropped).toBeGreaterThan(50);

	const { playlists } = await merge(...group);
	expect(playlists[0]?.songs).toEqual(expected);
});
