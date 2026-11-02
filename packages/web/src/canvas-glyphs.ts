import type { Face, Frame, Glyphs, Tone } from "./mosaic.ts";

const FAMILY: Record<Face, string> = {
	word: "'Montserrat Alternates'",
	katakana: "'Noto Sans JP'",
};
const font = (face: Face, size: number) => `700 ${size}px ${FAMILY[face]}`;

/** Canvas text does not trigger a web-font load, so the logo's faces are loaded first. */
export async function loadLogoFonts() {
	await Promise.all([
		document.fonts.load(font("word", 20), "u"),
		document.fonts.load(font("katakana", 20), "ソニックス"),
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

export interface Palette {
	background: string;
	word: string;
	katakana: string;
	teal: string;
	magenta: string;
}
export const DARK: Palette = {
	background: "#111111",
	word: "#ffffff",
	katakana: "#e234ce",
	teal: "#1ce5b5",
	magenta: "#e234ce",
};

export function drawFrame(g: CanvasRenderingContext2D, frame: Frame, palette: Palette) {
	g.fillStyle = palette.background;
	g.fillRect(0, 0, frame.width, frame.height);
	g.textBaseline = "top";
	for (const layer of frame.layers) {
		g.font = `700 ${layer.cell}px 'Roboto Mono'`;
		const cw = layer.cell * 0.6;
		const colour: Record<Tone, string> = {
			face: palette[layer.face],
			teal: palette.teal,
			magenta: palette.magenta,
		};
		// The copies first, so the face always sits on top.
		for (const tone of ["teal", "magenta", "face"] as const) {
			g.fillStyle = colour[tone];
			for (const c of layer.cells)
				if (c.tone === tone) g.fillText(c.glyph, c.col * cw, layer.top + c.row * layer.cell);
		}
	}
}
