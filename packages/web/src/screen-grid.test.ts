import { expect, test } from "bun:test";
import { screenGrid } from "./screen-grid.ts";

test("covers the first screen of the page from the hero's slot, with the logo on the slot's centre", () => {
	// The slot sits 100px in and 30px down the page, read after scrolling 80px.
	const grid = screenGrid(
		{ left: 100, top: -50, width: 800, height: 300 },
		{ width: 1200, height: 700, scrollX: 0, scrollY: 80 },
	);
	expect(grid).toEqual({
		left: -100,
		top: -30,
		width: 1200,
		height: 700,
		anchor: { x: 500, y: 180 },
	});
});
