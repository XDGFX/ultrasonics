/**
 * The first-run logo as an ASCII mosaic that tunes in like a signal (ADR-0027 §2). Pure and
 * deterministic from a seed and the times it is stepped at, so the README SVG is baked from it.
 */

/** Where the letterforms come from: canvas text in the browser, font outlines in the generator. */
export interface Glyphs {
	/** The advance width of `text` at `size` CSS pixels. */
	measure(text: string, face: Face, size: number): number;
	/** Alpha coverage (0–1) of the texts, each centred on (x, y), in a `width`×`height` mask of `scale` pixels per CSS pixel. */
	mask(request: MaskRequest): Float32Array;
}
export type Face = "word" | "katakana";
export interface MaskRequest {
	width: number;
	height: number;
	scale: number;
	face: Face;
	texts: { text: string; size: number; x: number; y: number }[];
}

export type Tone = "face" | "teal" | "magenta";
/** The order tones are painted in, so the face always sits on top of its copies. */
export const TONES: readonly Tone[] = ["teal", "magenta", "face"];
export interface Cell {
	col: number;
	row: number;
	glyph: string;
	tone: Tone;
}
export interface FrameLayer {
	face: Face;
	/** Font size of a glyph, and the height of its cell. */
	cell: number;
	cellWidth: number;
	top: number;
	cols: number;
	rows: number;
	cells: Cell[];
}
export interface Frame {
	width: number;
	height: number;
	layers: FrameLayer[];
}

export interface MosaicOptions {
	seed: number;
	width: number;
	height: number;
	/** The wordmark grid's font size; the katakana's grid is finer. */
	cell: number;
	glyphs: Glyphs;
	reduced?: boolean;
	/** Off when the caller times line glitches itself, as the README loop does. */
	idleGlitches?: boolean;
	/** Where the centre of the lockup sits; the middle of the grid unless given. */
	anchor?: Point | undefined;
}

export const WORDMARK = "ultrasonics";
export const KATAKANA = "ソニックス";
export const TUNE_SECONDS = 6;
export const RAMP = " .:-=+*#%@";
// Junk is what a bad packet decodes to: hex, half-width katakana, line noise.
const JUNK = "0123456789ABCDEFｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ<>/\\|[]{}";
// A monospace glyph's advance, as a fraction of its size.
const ASPECT = 0.6;
const GAIN = 1.2;
const RECOVERY = 1.3;
const CHROMA = 3;
const TEAR = 3;
const NOISE = 0.05;
const KATAKANA_RATIO = 0.23;

interface Look {
	gamma: number;
	max: number;
	chromaMax: number;
	magenta: boolean;
}
export interface Point {
	x: number;
	y: number;
}
interface Burst {
	at: Point;
	amount: number;
	left: number;
	duration: number;
}
/** What a layer needs to know of the whole picture's tuning while it draws. */
interface Signal {
	locked: boolean;
	tunedAt(x: number, y: number, t: number): number;
	nearLogo(x: number, y: number): number;
}
interface LayerOptions {
	face: Face;
	cell: number;
	top: number;
	width: number;
	height: number;
	look: Look;
	seed: number;
	/** Mask pixels per CSS pixel. */
	scale: number;
	/** Whether static can appear off the letterforms. */
	staticFloor: boolean;
	glyphs: Glyphs;
	texts: MaskRequest["texts"];
}

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => {
	const u = clamp(x);
	return u * u * (3 - 2 * u);
};
function hash(n: number) {
	let h = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
	h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number) {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const u = x - xi;
	const v = y - yi;
	const s = (t: number) => t * t * (3 - 2 * t);
	const h = (a: number, b: number) => hash((Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0);
	return lerp(
		lerp(h(xi, yi), h(xi + 1, yi), s(u)),
		lerp(h(xi, yi + 1), h(xi + 1, yi + 1), s(u)),
		s(v),
	);
}

/** One character grid over one band of the picture; positions and interference are in CSS pixels. */
class Layer {
	readonly face: Face;
	readonly cell: number;
	readonly top: number;
	readonly cellWidth: number;
	readonly cols: number;
	readonly rows: number;
	private readonly look: Look;
	private readonly seed: number;
	private readonly scale: number;
	private readonly staticFloor: boolean;
	private readonly maskWidth: number;
	private readonly maskHeight: number;
	/** A summed-area table of the mask, so any shifted cell's coverage is O(1). */
	private readonly coverageSums: Float32Array;
	/** Interference per cell, 0–1. */
	private damage: Float32Array;
	private nextDamage: Float32Array;
	// Each cell's own fixed randoms: its dither and loss threshold, its junk threshold, its flicker phase.
	private readonly grain: Float32Array;
	private readonly fragility: Float32Array;
	private readonly phase: Float32Array;
	private readonly tearX: Float32Array;
	private readonly rowDamage: Float32Array;

	constructor(o: LayerOptions) {
		this.face = o.face;
		this.cell = o.cell;
		this.top = o.top;
		this.look = o.look;
		this.seed = o.seed;
		this.scale = o.scale;
		this.staticFloor = o.staticFloor;
		this.cellWidth = o.cell * ASPECT;
		this.cols = Math.ceil(o.width / this.cellWidth) + 1;
		this.rows = Math.ceil(o.height / o.cell);
		this.maskWidth = Math.round(this.cols * this.cellWidth * o.scale);
		this.maskHeight = Math.round(this.rows * o.cell * o.scale);
		const alpha = o.glyphs.mask({
			width: this.maskWidth,
			height: this.maskHeight,
			scale: o.scale,
			face: o.face,
			texts: o.texts,
		});
		const stride = this.maskWidth + 1;
		this.coverageSums = new Float32Array(stride * (this.maskHeight + 1));
		for (let y = 0; y < this.maskHeight; y++) {
			let run = 0;
			for (let x = 0; x < this.maskWidth; x++) {
				run += alpha[y * this.maskWidth + x] ?? 0;
				this.coverageSums[(y + 1) * stride + x + 1] =
					(this.coverageSums[y * stride + x + 1] ?? 0) + run;
			}
		}
		const n = this.cols * this.rows;
		this.damage = new Float32Array(n);
		this.nextDamage = new Float32Array(n);
		this.grain = new Float32Array(n);
		this.fragility = new Float32Array(n);
		this.phase = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			this.grain[i] = hash(o.seed + i * 3 + 1);
			this.fragility[i] = hash(o.seed + i * 3 + 7919);
			this.phase[i] = hash(o.seed + i * 3 + 104729);
		}
		this.tearX = new Float32Array(this.rows);
		this.rowDamage = new Float32Array(this.rows);
	}

	/** Mean alpha of a cell-sized rect at cell (i, j), shifted by (dx, dy) CSS pixels. */
	private coverage(i: number, j: number, dx: number, dy: number) {
		const S = this.scale;
		const stride = this.maskWidth + 1;
		let x0 = Math.round((i * this.cellWidth + dx) * S);
		let y0 = Math.round((j * this.cell + dy) * S);
		let x1 = x0 + Math.round(this.cellWidth * S);
		let y1 = y0 + Math.round(this.cell * S);
		const area = (x1 - x0) * (y1 - y0);
		x0 = clamp(x0, 0, this.maskWidth);
		x1 = clamp(x1, 0, this.maskWidth);
		y0 = clamp(y0, 0, this.maskHeight);
		y1 = clamp(y1, 0, this.maskHeight);
		if (x1 <= x0 || y1 <= y0) return 0;
		const sum = (x: number, y: number) => this.coverageSums[y * stride + x] ?? 0;
		return (sum(x1, y1) - sum(x1, y0) - sum(x0, y1) + sum(x0, y0)) / area;
	}

	/** Interference is wide and short (scanline-shaped) and ragged with noise, never a round brush. */
	deposit(p: Point, amount: number, t: number) {
		const rx = 42 / this.cellWidth;
		const ry = 17 / this.cell;
		const ci = p.x / this.cellWidth;
		const cj = (p.y - this.top) / this.cell;
		for (
			let j = Math.max(0, Math.floor(cj - ry * 2));
			j <= Math.min(this.rows - 1, Math.ceil(cj + ry * 2));
			j++
		)
			for (
				let i = Math.max(0, Math.floor(ci - rx * 2));
				i <= Math.min(this.cols - 1, Math.ceil(ci + rx * 2));
				i++
			) {
				const dx = (i - ci) / rx;
				const dy = (j - cj) / ry;
				const falloff = Math.exp(-(dx * dx + dy * dy));
				if (falloff < 0.01) continue;
				const k = j * this.cols + i;
				const x = i * this.cellWidth;
				const y = this.top + j * this.cell;
				const ragged = 0.3 + 0.7 * noise(x * 0.037, y * 0.08 + t * 3);
				this.damage[k] = Math.min(1, (this.damage[k] ?? 0) + amount * falloff * ragged);
			}
	}

	step(t: number, dt: number) {
		const { cols, rows, damage, nextDamage } = this;
		// A damaged line bleeds along itself and decays towards a clean signal.
		const decay = Math.exp(-dt / RECOVERY);
		const side = Math.min(0.12, (0.12 * this.cellWidth) / 6);
		for (let j = 0; j < rows; j++)
			for (let i = 0; i < cols; i++) {
				const n = j * cols + i;
				const l = i > 0 ? (damage[n - 1] ?? 0) : 0;
				const r = i < cols - 1 ? (damage[n + 1] ?? 0) : 0;
				nextDamage[n] = ((damage[n] ?? 0) * (1 - 2 * side) + (l + r) * side) * decay;
			}
		this.damage = nextDamage;
		this.nextDamage = damage;
		// Rows share a smooth noise in pixel space, so a band slips together across both grids.
		for (let j = 0; j < rows; j++) {
			let most = 0;
			for (let i = 0; i < cols; i++) most = Math.max(most, this.damage[j * cols + i] ?? 0);
			this.rowDamage[j] = most;
		}
		for (let j = 0; j < rows; j++) {
			const c =
				((this.rowDamage[Math.max(0, j - 1)] ?? 0) +
					2 * (this.rowDamage[j] ?? 0) +
					(this.rowDamage[Math.min(rows - 1, j + 1)] ?? 0)) /
				4;
			const target = c * c * TEAR * (noise((this.top + j * this.cell) * 0.045, t * 1.7) * 2 - 1);
			this.tearX[j] = lerp(this.tearX[j] ?? 0, target, 1 - Math.exp(-dt * 18));
		}
	}

	draw(t: number, hum: { y: number; w: number }, signal: Signal): FrameLayer {
		const { cols, rows, cellWidth, cell, look, top } = this;
		const cells: Cell[] = [];
		for (let j = 0; j < rows; j++) {
			const tear = this.tearX[j] ?? 0;
			const y = top + j * cell;
			// The hum bar: a soft band rolling slowly down the picture, where the flicker is stronger.
			const humming = Math.exp(-(((y - hum.y) / hum.w) ** 2));
			for (let i = 0; i < cols; i++) {
				const n = j * cols + i;
				const damage = Math.min(1, this.damage[n] ?? 0);
				const grain = this.grain[n] ?? 0;
				const fragility = this.fragility[n] ?? 0;
				const x = i * cellWidth;
				const tuning = signal.locked ? 1 : signal.tunedAt(x + cellWidth / 2, y + cell / 2, t);
				const mistuning = 1 - tuning;
				// Signal strength rises with tuning, so values climb from black rather than fading in.
				const strength = tuning ** 1.4;
				// Off-station the picture swims: a smooth warp, coherent between neighbours.
				let wx = 0;
				let wy = 0;
				if (mistuning > 0) {
					wx = (noise(x * 0.011 + 5, y * 0.018 + t * 0.25) * 2 - 1) * mistuning * 38;
					wy = (noise(x * 0.011 + 50, y * 0.018 + t * 0.25 + 9) * 2 - 1) * mistuning * 12;
				}
				// At rest the split is about a cell; interference and mistuning both widen it.
				const splitX = cellWidth * 1.1 + damage * CHROMA + mistuning * 22;
				const splitY = cell * 0.45 + damage * CHROMA * 0.1 + mistuning * 5;
				// Each cell has its own loss threshold, so loss and recovery are staggered, never a fade.
				const loss = clamp((damage - 0.06 - grain * 0.5) * 2.4);
				const signalHere = this.coverage(i, j, tear + wx, wy) * (1 - loss);
				let level = 0;
				let tone: Tone | null = null;
				// Dithered by the cell's own random, so a weak signal shows as sparse low glyphs.
				if (signalHere > 0.05)
					level = Math.floor(
						Math.min(1, signalHere * 1.2) ** look.gamma * look.max * strength + grain * 0.999,
					);
				if (level >= 1) tone = "face";
				else {
					// Sampling right-and-up draws the teal copy down-left.
					const teal = this.coverage(i, j, tear + wx + splitX, wy - splitY);
					const magenta = look.magenta ? this.coverage(i, j, tear + wx - splitX, wy + splitY) : 0;
					const copy = Math.max(teal, magenta);
					// Chroma tops out lower on the ramp so the face always reads first.
					if (copy > 0.08) {
						level = Math.floor(copy * look.chromaMax * strength + grain * 0.999);
						if (level >= 1) tone = teal >= magenta ? "teal" : "magenta";
					}
				}
				// Static gathers at the tuning front and under interference, falling away from the logo.
				if (!tone && this.staticFloor && (tuning < 1 || damage > 0.02)) {
					const chance = (0.07 * 4 * tuning * mistuning + damage * 0.05) * signal.nearLogo(x, y);
					if (hash(n * 13 + Math.floor(t * 12 + grain * 12)) < chance) {
						const s = hash(n * 7 + Math.floor(t * 12 + fragility * 12));
						level = 1 + Math.floor(s * s * (1 + 3 * tuning));
						tone = s < 0.6 ? "face" : s < 0.8 ? "teal" : "magenta";
					}
				}
				if (!tone) continue;
				// Analogue flicker: each cell re-rolls about ten times a second, out of step with its
				// neighbours, usually one notch down the ramp, occasionally one up.
				const roll = hash(n * 17 + this.seed + Math.floor(t * 10 + (this.phase[n] ?? 0) * 10));
				const flicker = NOISE * (0.07 + 0.18 * humming);
				if (roll < flicker) level -= 1;
				else if (roll > 1 - flicker * 0.35) level += 1;
				let glyph = RAMP[clamp(level, 1, 9)] as string;
				if (damage > 0.42 + fragility * 0.5 || roll < flicker * 0.04) {
					glyph = JUNK[
						Math.floor(hash(n * 31 + Math.floor(t * 7 + grain * 7)) * JUNK.length)
					] as string;
					if (hash(n + Math.floor(t * 3)) < damage * 0.35)
						tone = tone === "teal" ? "magenta" : "teal";
				}
				cells.push({ col: i, row: j, glyph, tone });
			}
		}
		return { face: this.face, cell, cellWidth, top, cols, rows, cells };
	}
}

export type Mosaic = ReturnType<typeof createMosaic>;

export function createMosaic({
	seed,
	width,
	height,
	cell,
	glyphs,
	reduced = false,
	idleGlitches = true,
	anchor = { x: width / 2, y: height / 2 },
}: MosaicOptions) {
	const wordWidth = Math.min(1000, width - 32) * 0.88;
	const wordSize = (100 * wordWidth) / glyphs.measure(WORDMARK, "word", 100);
	const kanaSize = wordSize * KATAKANA_RATIO;
	const fine = Math.max(3, Math.round(cell * 0.45 * 10) / 10);
	// The lockup is centred on the anchor: the name, then the katakana under it.
	const wordY = anchor.y - (wordSize + 1.3 * kanaSize) / 2 + 0.45 * wordSize;
	const kanaY = wordY + wordSize * 0.55 + kanaSize * 0.7;
	const base = Math.imul(seed, 7919);
	// The wordmark's grid covers the whole picture, so the static and the tuning have no edges.
	const word = new Layer({
		face: "word",
		cell,
		top: 0,
		width,
		height: height + cell,
		// The face leans dense (a low gamma) so the name reads at a glance.
		look: { gamma: 0.55, max: 9, chromaMax: 6, magenta: true },
		seed: base,
		scale: 1,
		staticFloor: true,
		glyphs,
		texts: [{ text: WORDMARK, size: wordSize, x: anchor.x, y: wordY + wordSize * 0.06 }],
	});
	// The katakana has a finer grid of its own: on the wordmark's cells it would have three rows.
	const kanaTop = kanaY - kanaSize;
	const span = wordWidth * 0.96;
	const left = anchor.x - span / 2 + kanaSize / 2;
	const kana = new Layer({
		face: "katakana",
		cell: fine,
		top: kanaTop,
		width,
		height: kanaSize * 2,
		// Capped at "#", so it sits under the name rather than beside it.
		look: { gamma: 0.7, max: 7, chromaMax: 5, magenta: false },
		seed: base + 1e6,
		scale: 2,
		staticFloor: false,
		glyphs,
		texts: [...KATAKANA].map((text, k) => ({
			text,
			size: kanaSize,
			x: left + (k * (span - kanaSize)) / 4,
			y: kanaSize,
		})),
	});
	const layers = [word, kana];
	const boxTop = wordY - wordSize * 0.45;
	const boxBottom = kanaY + kanaSize * 0.6;
	const box = {
		cx: anchor.x,
		cy: (boxTop + boxBottom) / 2,
		hw: wordWidth / 2,
		hh: (boxBottom - boxTop) / 2,
	};
	let draws = 0;
	const random = () => hash(base + 31 * ++draws);
	let t0: number | null = null;
	let pointer: Point | null = null;
	let prev: Point | null = null;
	let pending: Burst[] = [];
	let nextGlitch = TUNE_SECONDS + 2 + random() * 3;
	let dial = reduced ? 1 : 0;
	const deposit = (p: Point, amount: number, t: number) => {
		for (const l of layers) l.deposit(p, amount, t);
	};
	/** A line glitch across the name. */
	const glitch = () => {
		const y = wordY + (random() - 0.5) * wordSize * 0.9;
		for (let x = 24; x < width; x += 54)
			pending.push({ at: { x, y }, amount: 0.35, left: 0.18, duration: 0.18 });
	};
	const signal: Signal = {
		get locked() {
			return dial >= 1;
		},
		// Each point's tuning is the dial plus a slow drifting offset, so patches lock at different times.
		tunedAt(x, y, t) {
			const o =
				noise(x * 0.0035 + 11, y * 0.006 + t * 0.04) * 0.65 +
				noise(x * 0.011 + 3, y * 0.017 - t * 0.07) * 0.35;
			return smooth(dial * 1.65 - 0.25 + 0.7 * (o - 0.5) + 0.25 * signal.nearLogo(x, y));
		},
		// 1 on the logo, falling to 0 about 130px from its box.
		nearLogo(x, y) {
			const dx = Math.max(0, Math.abs(x - box.cx) - box.hw);
			const dy = Math.max(0, Math.abs(y - box.cy) - box.hh);
			return Math.exp(-(dx * dx + dy * dy) / (130 * 130));
		},
	};

	return {
		/** Where the cursor is over the picture, or null once it has left. */
		pointer(p: Point | null) {
			pointer = p;
			if (!p) prev = null;
		},
		/** A click: a short, strong burst of interference. */
		press(p: Point) {
			pointer = p;
			pending.push({ at: p, amount: 0.9, left: 0.14, duration: 0.14 });
		},
		glitch,
		step(t: number, dt: number) {
			if (reduced) return;
			// The dial moves from the first frame and eases out, so the picture never snaps into place.
			if (t0 === null) t0 = t;
			dial = 1 - (1 - clamp((t - t0) / TUNE_SECONDS)) ** 2.2;
			for (const l of layers) l.step(t, dt);
			if (pointer) {
				const from = prev ?? pointer;
				const dist = Math.hypot(pointer.x - from.x, pointer.y - from.y);
				const speed = clamp(dist / 30);
				const steps = Math.max(1, Math.ceil(dist / 6));
				for (let s = 1; s <= steps; s++)
					deposit(
						{ x: lerp(from.x, pointer.x, s / steps), y: lerp(from.y, pointer.y, s / steps) },
						(GAIN * 0.5 * speed) / steps,
						t,
					);
				// A cursor held still is a weak, steady source: the picture never quite settles under it.
				deposit(pointer, GAIN * 0.045 * dt * 60 * (1 - speed), t);
				prev = { ...pointer };
			}
			// Bursts ramp in over a few frames rather than popping.
			for (const b of pending) {
				const share = Math.min(b.left, dt);
				b.left -= share;
				deposit(b.at, (b.amount * GAIN * share) / b.duration, t);
			}
			pending = pending.filter((b) => b.left > 0);
			if (idleGlitches && t > nextGlitch && dial >= 1) {
				nextGlitch = t + 3.5 + random() * 6;
				glitch();
			}
		},
		frame(t: number): Frame {
			const hum = { y: (((t * 0.09) % 1.6) - 0.3) * height, w: height * 0.14 };
			return { width, height, layers: layers.map((l) => l.draw(t, hum, signal)) };
		},
	};
}
