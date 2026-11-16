import { expect, test } from "bun:test";
import { SongDict } from "@ultrasonics/plugin-sdk";
import { library } from "./library.ts";
import { mergeByName } from "./merge.ts";

/** Spec #186, story 13: two 10,000-song playlists merge in seconds (#230). */
const size = 10_000;
const budgetMs = 10_000;
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

for (const overlap of [0, 0.5, 0.8]) {
	test(
		`two ${size}-song playlists with ${overlap * 100}% in common merge in under ${budgetMs / 1000} s`,
		() => {
			const group = SongDict.parse({ playlists: library(230).pair(size, overlap) }).playlists;
			const started = performance.now();
			const [merged] = mergeByName(group, quiet);
			const elapsedMs = performance.now() - started;

			// The shared songs carry no common key, so only weighing finds them.
			expect(2 * size - (merged?.songs.length ?? 0)).toBeGreaterThanOrEqual(size * overlap);
			expect(elapsedMs).toBeLessThan(budgetMs);
		},
		3 * budgetMs,
	);
}
