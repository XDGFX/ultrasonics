/**
 * Regenerates the baked logo files from the same renderer the app uses (ADR-0027 §§3–4):
 * the README SVGs, and the chroma-pixel mark as the favicon and home-screen icon.
 * Run with `bun run logo` in packages/web, and commit what it writes.
 */
import { resolve } from "node:path";
import { MARK, TOUCH_ICON } from "../src/logo-assets.ts";
import { createMosaic, type Frame, TUNE_SECONDS } from "../src/mosaic.ts";
import { chromaPixels, markPng, markSvg } from "./chroma-pixel.ts";
import { loadFonts, outlineGlyphs } from "./outline-glyphs.ts";
import { readmeSvg } from "./readme-svg.ts";

const ASSETS = resolve(import.meta.dir, "../../../docs/assets");
const PUBLIC = resolve(import.meta.dir, "../public");
// 16 blocks: one per pixel in a 16px favicon, two in the 32px rail mark.
const MARK_BLOCKS = 16;
// Full size (ADR-0027 §4): a grid this wide sets the wordmark about 880px across, then the
// picture keeps the middle 930px.
const GRID_WIDTH = 1032;
const PICTURE_WIDTH = 930;
const FPS = 10;
const LOOP_SECONDS = 3.5;

const glyphs = outlineGlyphs(await loadFonts());

const alpha = glyphs.mask({
	width: MARK_BLOCKS,
	height: MARK_BLOCKS,
	scale: 1,
	face: "katakana",
	texts: [{ text: "ソ", size: MARK_BLOCKS * 0.8, x: MARK_BLOCKS / 2, y: MARK_BLOCKS * 0.42 }],
});
const blocks = chromaPixels(alpha, MARK_BLOCKS);
await Bun.write(resolve(PUBLIC, MARK), markSvg(blocks, MARK_BLOCKS));
await Bun.write(resolve(PUBLIC, TOUCH_ICON), markPng(blocks, MARK_BLOCKS, 180));

const mosaic = createMosaic({
	seed: 1,
	width: GRID_WIDTH,
	height: 252,
	cell: 10,
	glyphs,
	idleGlitches: false,
});
const tuneIn: Frame[] = [];
const loop: Frame[] = [];
for (let f = 0; f < (TUNE_SECONDS + LOOP_SECONDS) * 60; f++) {
	const t = f / 60;
	// A line glitch early in the loop has decayed before it wraps.
	if (f === (TUNE_SECONDS + 0.3) * 60) mosaic.glitch();
	mosaic.step(t, 1 / 60);
	if (f % (60 / FPS) === 0) (t < TUNE_SECONDS ? tuneIn : loop).push(mosaic.frame(t));
}
const still = loop[0] as Frame;
const crop = { x: (GRID_WIDTH - PICTURE_WIDTH) / 2, width: PICTURE_WIDTH };
for (const theme of ["dark", "light"] as const)
	await Bun.write(
		resolve(ASSETS, `logo-${theme}.svg`),
		readmeSvg({ tuneIn, loop, still, fps: FPS, theme, crop }),
	);
console.log(`wrote the README logos in ${ASSETS}, and ${MARK} and ${TOUCH_ICON} in ${PUBLIC}`);
