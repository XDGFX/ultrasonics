import { deflateSync } from "node:zlib";
import type { Tone } from "../src/mosaic.ts";

export interface Block {
	x: number;
	y: number;
	tone: Tone;
}

const COLOUR: Record<Tone | "tile", string> = {
	tile: "#111111",
	teal: "#1ce5b5",
	magenta: "#e234ce",
	face: "#ffffff",
};
// The prototype's threshold for a lit block, out of 255.
const LIT = 110 / 255;

/** ADR-0027 §3's chroma-pixel mark: each lit block, with teal down-left and magenta up-right where the face is dark. */
export function chromaPixels(alpha: Float32Array, size: number): Block[] {
	const lit = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < size && y < size && (alpha[y * size + x] ?? 0) > LIT;
	const blocks: Block[] = [];
	for (const [tone, dx, dy] of [
		["teal", -1, 1],
		["magenta", 1, -1],
		["face", 0, 0],
	] as const)
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				if (!lit(x, y)) continue;
				const bx = x + dx;
				const by = y + dy;
				if (bx < 0 || by < 0 || bx >= size || by >= size) continue;
				if (tone === "face" || !lit(bx, by)) blocks.push({ x: bx, y: by, tone });
			}
	return blocks;
}

export function markSvg(blocks: Block[], size: number) {
	const rects = blocks
		.map((b) => `<rect x="${b.x}" y="${b.y}" width="1" height="1" fill="${COLOUR[b.tone]}"/>`)
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><title>ultrasonics</title><rect width="${size}" height="${size}" fill="${COLOUR.tile}"/>${rects}</svg>\n`;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(bytes: Uint8Array) {
	let c = 0xffffffff;
	for (const b of bytes) c = (CRC[(c ^ b) & 0xff] as number) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** The mark as an opaque `px`-square PNG, for the home-screen icon. */
export function markPng(blocks: Block[], size: number, px: number) {
	const tone = new Map(blocks.map((b) => [b.y * size + b.x, b.tone]));
	const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
	const raw = new Uint8Array(px * (px * 3 + 1));
	for (let y = 0; y < px; y++)
		for (let x = 0; x < px; x++) {
			const cell = Math.floor((y * size) / px) * size + Math.floor((x * size) / px);
			raw.set(rgb(COLOUR[tone.get(cell) ?? "tile"]), y * (px * 3 + 1) + 1 + x * 3);
		}
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, px);
	view.setUint32(4, px);
	header.set([8, 2, 0, 0, 0], 8);
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array()),
	];
	return Buffer.concat(parts);
}
