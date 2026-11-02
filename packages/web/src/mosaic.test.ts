import { describe, expect, test } from "bun:test";
import { createMosaic, type Frame, type Glyphs, RAMP, TUNE_SECONDS } from "./mosaic.ts";

// Every text run fills a solid box, so the expected coverage is easy to reason about.
const boxGlyphs: Glyphs = {
	measure: (text, _face, size) => text.length * size * 0.6,
	mask: ({ width, height, scale, texts }) => {
		const alpha = new Float32Array(width * height);
		for (const { text, size, x, y } of texts) {
			const half = (text.length * size * 0.6) / 2;
			for (let py = Math.floor((y - size * 0.35) * scale); py < (y + size * 0.35) * scale; py++)
				for (let px = Math.floor((x - half) * scale); px < (x + half) * scale; px++)
					if (px >= 0 && py >= 0 && px < width && py < height) alpha[py * width + px] = 1;
		}
		return alpha;
	},
};

const size = { width: 480, height: 200, cell: 10 };

function run(seed: number, until: number, setup?: (m: ReturnType<typeof createMosaic>) => void) {
	const mosaic = createMosaic({ seed, ...size, glyphs: boxGlyphs });
	setup?.(mosaic);
	const frames = Math.round(until * 60);
	for (let f = 0; f <= frames; f++) mosaic.step(f / 60, 1 / 60);
	return mosaic.frame(frames / 60);
}

/** One line per grid row: the glyph, or a tone letter for the chroma copies. */
function picture(frame: Frame) {
	return frame.layers.map((layer) => {
		const grid: string[][] = Array.from({ length: layer.rows }, () => Array(layer.cols).fill(" "));
		for (const c of layer.cells) {
			const row = grid[c.row] as string[];
			row[c.col] = c.tone === "face" ? c.glyph : c.tone === "teal" ? "t" : "m";
		}
		return grid.map((row) => row.join("").trimEnd()).join("\n");
	});
}

const count = (frame: Frame, tone: string) =>
	frame.layers.flatMap((l) => l.cells).filter((c) => c.tone === tone).length;

/** How far up the ramp the face has climbed, summed over its cells. */
const density = (frame: Frame) =>
	frame.layers
		.flatMap((l) => l.cells)
		.filter((c) => c.tone === "face")
		.reduce((sum, c) => sum + Math.max(0, RAMP.indexOf(c.glyph)), 0);

describe("the mosaic", () => {
	const tuned = run(1, TUNE_SECONDS + 1);

	test("starts from black, with at most a little static", () => {
		expect(density(run(1, 0))).toBeLessThan(density(tuned) * 0.05);
	});

	test("climbs the ramp as it tunes in", () => {
		const early = density(run(1, 0.5));
		expect(early).toBeGreaterThan(density(run(1, 0)));
		expect(early).toBeLessThan(density(tuned) * 0.5);
	});

	test("has tuned in, face over teal and magenta copies, once the tune-in is over", () => {
		expect(count(tuned, "face")).toBeGreaterThan(100);
		expect(count(tuned, "teal")).toBeGreaterThan(0);
		expect(count(tuned, "magenta")).toBeGreaterThan(0);
	});

	test("shows fully tuned from the first frame under reduced motion", () => {
		const still = createMosaic({ seed: 1, ...size, glyphs: boxGlyphs, reduced: true }).frame(0);
		expect(count(still, "face")).toBeGreaterThan(100);
	});

	test("is the same picture for the same seed and time, and a different one for another seed", () => {
		expect(picture(run(3, 2.5))).toEqual(picture(run(3, 2.5)));
		expect(picture(run(3, 2.5))).not.toEqual(picture(run(4, 2.5)));
	});

	test("drops cells under the cursor and resyncs once it leaves", () => {
		const settled = TUNE_SECONDS + 1;
		const clean = density(run(1, settled));
		const mosaic = createMosaic({ seed: 1, ...size, glyphs: boxGlyphs });
		const frames = Math.round(settled * 60);
		for (let f = 0; f <= frames; f++) {
			if (f > frames - 30) mosaic.pointer({ x: 120 + (f % 30) * 8, y: size.height / 2 - 10 });
			mosaic.step(f / 60, 1 / 60);
		}
		const hit = mosaic.frame(frames / 60);
		expect(density(hit)).toBeLessThan(clean * 0.9);
		mosaic.pointer(null);
		for (let f = frames + 1; f <= frames + 6 * 60; f++) mosaic.step(f / 60, 1 / 60);
		expect(density(mosaic.frame((frames + 6 * 60) / 60))).toBeGreaterThan(clean * 0.95);
	});

	test("pins its output for a seed and time", () => {
		expect(picture(run(7, 3)).join("\n\n")).toMatchSnapshot();
		expect(picture(run(7, TUNE_SECONDS + 2)).join("\n\n")).toMatchSnapshot();
	});
});
