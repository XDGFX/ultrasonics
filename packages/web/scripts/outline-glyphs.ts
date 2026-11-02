import { type Font, parse } from "opentype.js";
import type { Face, Glyphs } from "../src/mosaic.ts";

const FILES: Record<Face, string> = {
	word: "@fontsource/montserrat-alternates/files/montserrat-alternates-latin-700-normal.woff",
	katakana: "@fontsource/noto-sans-jp/files/noto-sans-jp-119-700-normal.woff",
};
// Sub-rows per mask row: coverage is exact across a row and sampled down it.
const SUB = 4;

export async function loadFonts(): Promise<Record<Face, Font>> {
	const load = async (face: Face) =>
		parse(await Bun.file(Bun.resolveSync(FILES[face], import.meta.dir)).arrayBuffer());
	return { word: await load("word"), katakana: await load("katakana") };
}

type Edge = [x0: number, y0: number, x1: number, y1: number];

/** Straight edges of `text` drawn centred on (x, y) with a middle baseline, as canvas text is. */
function outline(font: Font, text: string, size: number, x: number, y: number): Edge[] {
	const baseline = y + ((font.ascender + font.descender) / 2 / font.unitsPerEm) * size;
	const path = font.getPath(text, x - font.getAdvanceWidth(text, size) / 2, baseline, size);
	const edges: Edge[] = [];
	let sx = 0;
	let sy = 0;
	let cx = 0;
	let cy = 0;
	const to = (nx: number, ny: number) => {
		edges.push([cx, cy, nx, ny]);
		cx = nx;
		cy = ny;
	};
	const curve = (at: (t: number) => [number, number]) => {
		for (let k = 1; k <= 12; k++) to(...at(k / 12));
	};
	for (const c of path.commands) {
		const px = c.x ?? 0;
		const py = c.y ?? 0;
		if (c.type === "M") {
			cx = sx = px;
			cy = sy = py;
		} else if (c.type === "L") to(px, py);
		else if (c.type === "Q") {
			const [x0, y0, x1, y1] = [cx, cy, c.x1 ?? 0, c.y1 ?? 0];
			curve((t) => {
				const u = 1 - t;
				return [u * u * x0 + 2 * u * t * x1 + t * t * px, u * u * y0 + 2 * u * t * y1 + t * t * py];
			});
		} else if (c.type === "C") {
			const [x0, y0, x1, y1, x2, y2] = [cx, cy, c.x1 ?? 0, c.y1 ?? 0, c.x2 ?? 0, c.y2 ?? 0];
			curve((t) => {
				const u = 1 - t;
				const [a, b, d, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
				return [a * x0 + b * x1 + d * x2 + e * px, a * y0 + b * y1 + d * y2 + e * py];
			});
		} else to(sx, sy);
	}
	return edges;
}

/** Non-zero fill of the edges into an alpha mask, in mask pixels. */
export function rasterise(edges: Edge[], width: number, height: number) {
	const alpha = new Float32Array(width * height);
	const crossings: [number, number][] = [];
	for (let py = 0; py < height; py++)
		for (let s = 0; s < SUB; s++) {
			const y = py + (s + 0.5) / SUB;
			crossings.length = 0;
			for (const [x0, y0, x1, y1] of edges) {
				if (y0 === y1 || y < Math.min(y0, y1) || y >= Math.max(y0, y1)) continue;
				crossings.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
			}
			crossings.sort((a, b) => a[0] - b[0]);
			let winding = 0;
			for (let k = 0; k < crossings.length - 1; k++) {
				winding += (crossings[k] as [number, number])[1];
				if (winding === 0) continue;
				const a = Math.max(0, (crossings[k] as [number, number])[0]);
				const b = Math.min(width, (crossings[k + 1] as [number, number])[0]);
				for (let px = Math.floor(a); px < b; px++) {
					const cover = Math.min(b, px + 1) - Math.max(a, px);
					const i = py * width + px;
					alpha[i] = (alpha[i] ?? 0) + cover / SUB;
				}
			}
		}
	return alpha;
}

/** Letterforms from the bundled fonts' outlines, for rendering without a browser. */
export function outlineGlyphs(fonts: Record<Face, Font>): Glyphs {
	return {
		measure: (text, face, size) => fonts[face].getAdvanceWidth(text, size),
		mask: ({ width, height, scale, face, texts }) =>
			rasterise(
				texts.flatMap(({ text, size, x, y }) =>
					outline(fonts[face], text, size * scale, x * scale, y * scale),
				),
				width,
				height,
			),
	};
}
