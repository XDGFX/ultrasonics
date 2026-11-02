import { MAGENTA, TEAL, THEMES, type Theme } from "../src/logo-palette.ts";
import { type Cell, type Frame, type FrameLayer, TONES } from "../src/mosaic.ts";

export interface ReadmeFrames {
	tuneIn: Frame[];
	/** Follows the tune-in and repeats: the hold, with its flicker and line tear. */
	loop: Frame[];
	/** The whole picture under reduced motion. */
	still: Frame;
	fps: number;
	/** The README picks one with `<picture>`, which GitHub matches to the reader's theme. */
	theme: Theme;
	/** A horizontal window onto the frame, for when the grid is wider than the picture. */
	crop?: { x: number; width: number };
}

const escapeXml = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n: number) => String(Math.round(n * 100) / 100);

function drawLayer(layer: FrameLayer) {
	const out: string[] = [];
	for (const tone of TONES) {
		const rows = new Map<number, Cell[]>();
		for (const c of layer.cells)
			if (c.tone === tone) rows.set(c.row, [...(rows.get(c.row) ?? []), c]);
		for (const [row, cells] of [...rows].sort((a, b) => a[0] - b[0])) {
			cells.sort((a, b) => a.col - b.col);
			// One x per glyph pins each to its cell, whatever monospace face the reader falls back to.
			const xs = cells.map((c) => num(c.col * layer.cellWidth)).join(" ");
			const y = layer.top + row * layer.cell + layer.cell * 0.8;
			const text = escapeXml(cells.map((c) => c.glyph).join(""));
			out.push(`<text class="${tone}" x="${xs}" y="${num(y)}">${text}</text>`);
		}
	}
	return `<g class="${layer.face}" font-size="${num(layer.cell)}">${out.join("")}</g>`;
}

const drawFrame = (frame: Frame) => frame.layers.map(drawLayer).join("");

/** The README logo (ADR-0027 §4): CSS animation and media queries only, as GitHub shows it as an image. */
export function readmeSvg({ tuneIn, loop, still, fps, theme, crop }: ReadmeFrames) {
	const held = tuneIn.length / fps;
	const { x, width } = crop ?? { x: 0, width: still.width };
	const { height } = still;
	const group = (cls: string, delay: number | null, frame: Frame) =>
		`<g class="f ${cls}"${delay === null ? "" : ` style="animation-delay:${num(delay)}s"`}>${drawFrame(frame)}</g>`;
	// A tune-in frame shows for its own slot; the loop's frames then take turns forever.
	const style = `
text{font-family:"Roboto Mono",ui-monospace,Menlo,Consolas,"DejaVu Sans Mono",monospace;font-weight:700}
.face{fill:${THEMES[theme].word}}.katakana .face{fill:${THEMES[theme].katakana}}.teal{fill:${TEAL}}.magenta{fill:${MAGENTA}}
.f{visibility:hidden}
@keyframes on{from,to{visibility:visible}}
@keyframes loop{0%{visibility:visible}${num(100 / loop.length)}%,100%{visibility:hidden}}
.tune{animation:on ${num(1 / fps)}s step-end}
.loop{animation:loop ${num(loop.length / fps)}s step-end infinite}
@media (prefers-reduced-motion: reduce){.f{animation:none}.still{visibility:visible}}
`;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x)} 0 ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}" role="img" aria-label="ultrasonics">`,
		`<style>${style}</style>`,
		...tuneIn.map((f, k) => group("tune", k / fps, f)),
		...loop.map((f, k) => group("loop", held + k / fps, f)),
		group("still", null, still),
		"</svg>",
		"",
	].join("\n");
}
