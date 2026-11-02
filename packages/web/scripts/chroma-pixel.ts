import { MAGENTA, TEAL, THEMES } from "../src/logo-palette.ts";
import { TONES, type Tone } from "../src/mosaic.ts";
import { encodePng } from "./png.ts";

export interface Block {
	x: number;
	y: number;
	tone: Tone;
}

const COLOUR: Record<Tone | "tile", string> = {
	tile: THEMES.dark.background,
	teal: TEAL,
	magenta: MAGENTA,
	face: THEMES.dark.word,
};
// Teal sits down-left of the face and magenta up-right, as in the wordmark.
const OFFSET: Record<Tone, [number, number]> = { teal: [-1, 1], magenta: [1, -1], face: [0, 0] };
// A block lights at a little under half coverage, so thin strokes stay unbroken.
const LIT = 110 / 255;

/** ADR-0027 §3's chroma-pixel mark: each lit block, with its copies where the face is dark. */
export function chromaPixels(alpha: Float32Array, size: number): Block[] {
	const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size;
	const lit = (x: number, y: number) => inside(x, y) && (alpha[y * size + x] ?? 0) > LIT;
	const blocks: Block[] = [];
	for (const tone of TONES) {
		const [dx, dy] = OFFSET[tone];
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				if (!lit(x, y) || !inside(x + dx, y + dy)) continue;
				if (tone === "face" || !lit(x + dx, y + dy)) blocks.push({ x: x + dx, y: y + dy, tone });
			}
	}
	return blocks;
}

export function markSvg(blocks: Block[], size: number) {
	const rects = blocks
		.map((b) => `<rect x="${b.x}" y="${b.y}" width="1" height="1" fill="${COLOUR[b.tone]}"/>`)
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><title>ultrasonics</title><rect width="${size}" height="${size}" fill="${COLOUR.tile}"/>${rects}</svg>\n`;
}

/** The mark as a `px`-square PNG, in whole-pixel blocks centred on the tile. */
export function markPng(blocks: Block[], size: number, px: number) {
	const tone = new Map(blocks.map((b) => [b.y * size + b.x, b.tone]));
	const block = Math.floor(px / size);
	const inset = Math.floor((px - block * size) / 2);
	return encodePng(px, px, (x, y) => {
		const bx = Math.floor((x - inset) / block);
		const by = Math.floor((y - inset) / block);
		const inGrid = x >= inset && y >= inset && bx < size && by < size;
		return COLOUR[(inGrid && tone.get(by * size + bx)) || "tile"];
	});
}
