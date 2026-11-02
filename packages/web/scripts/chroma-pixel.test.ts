import { describe, expect, test } from "bun:test";
import { chromaPixels } from "./chroma-pixel.ts";

const grid = (lit: [number, number][], size = 4) => {
	const alpha = new Float32Array(size * size);
	for (const [x, y] of lit) alpha[y * size + x] = 1;
	return alpha;
};

describe("the chroma-pixel mark", () => {
	test("puts a teal copy down-left and a magenta copy up-right of each lit block", () => {
		expect(chromaPixels(grid([[1, 1]]), 4)).toEqual([
			{ x: 0, y: 2, tone: "teal" },
			{ x: 2, y: 0, tone: "magenta" },
			{ x: 1, y: 1, tone: "face" },
		]);
	});

	test("shows the copies only where the face is dark and inside the tile", () => {
		// (2, 0)'s teal copy lands on lit (1, 1); (1, 1)'s magenta lands on lit (2, 0); (2, 0)'s is off the tile.
		const cells = chromaPixels(
			grid([
				[1, 1],
				[2, 0],
			]),
			4,
		);
		expect(cells.filter((c) => c.tone !== "face")).toEqual([{ x: 0, y: 2, tone: "teal" }]);
	});
});
