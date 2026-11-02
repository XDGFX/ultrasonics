import { MAGENTA, TEAL, THEMES } from "./logo-palette.ts";
import {
	type Face,
	type Frame,
	type Glyphs,
	KATAKANA,
	TONES,
	type Tone,
	WORDMARK,
} from "./mosaic.ts";

const FAMILY: Record<Face, string> = {
	word: "'Montserrat Alternates'",
	katakana: "'Noto Sans JP'",
};
const font = (face: Face, size: number) => `700 ${size}px ${FAMILY[face]}`;

/** Canvas text does not trigger a web-font load, so the logo's faces are loaded first. */
export async function loadLogoFonts() {
	await Promise.all([
		document.fonts.load(font("word", 20), WORDMARK),
		document.fonts.load(font("katakana", 20), KATAKANA),
		document.fonts.load("700 20px 'Roboto Mono'", "@"),
	]);
}

/** Letterforms rasterised by the browser's own text renderer. */
export const canvasGlyphs: Glyphs = {
	measure(text, face, size) {
		const g = document.createElement("canvas").getContext("2d");
		if (!g) return text.length * size * 0.6;
		g.font = font(face, size);
		return g.measureText(text).width;
	},
	mask({ width, height, scale, face, texts }) {
		const alpha = new Float32Array(width * height);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const g = canvas.getContext("2d");
		if (!g || width === 0 || height === 0) return alpha;
		g.scale(scale, scale);
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.fillStyle = "#fff";
		for (const { text, size, x, y } of texts) {
			g.font = font(face, size);
			g.fillText(text, x, y);
		}
		const px = g.getImageData(0, 0, width, height).data;
		for (let i = 0; i < alpha.length; i++) alpha[i] = (px[i * 4 + 3] ?? 0) / 255;
		return alpha;
	},
};

/** Draws a frame on a transparent canvas, so the page shows through and the grid has no edge. */
export function drawFrame(g: CanvasRenderingContext2D, frame: Frame) {
	g.clearRect(0, 0, frame.width, frame.height);
	g.textBaseline = "top";
	for (const layer of frame.layers) {
		g.font = `700 ${layer.cell}px 'Roboto Mono'`;
		const colour: Record<Tone, string> = {
			face: THEMES.dark[layer.face],
			teal: TEAL,
			magenta: MAGENTA,
		};
		for (const tone of TONES) {
			g.fillStyle = colour[tone];
			for (const c of layer.cells)
				if (c.tone === tone)
					g.fillText(c.glyph, c.col * layer.cellWidth, layer.top + c.row * layer.cell);
		}
	}
}
