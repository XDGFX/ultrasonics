import { expect, test } from "bun:test";
import { rasterise } from "./outline-glyphs.ts";

test("rasterises a shape to its area coverage per pixel", () => {
	// A square from (0.5, 0.5) to (2.5, 2.5): quarter corners, half edges, a full centre.
	const square: [number, number, number, number][] = [
		[0.5, 0.5, 2.5, 0.5],
		[2.5, 0.5, 2.5, 2.5],
		[2.5, 2.5, 0.5, 2.5],
		[0.5, 2.5, 0.5, 0.5],
	];
	expect([...rasterise(square, 3, 3)]).toEqual([0.25, 0.5, 0.25, 0.5, 1, 0.5, 0.25, 0.5, 0.25]);
});
