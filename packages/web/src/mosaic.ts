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
export interface Cell {
	col: number;
	row: number;
	glyph: string;
	tone: Tone;
}
export interface FrameLayer {
	face: Face;
	/** Font size of a glyph; a cell is 0.6 of it wide. */
	cell: number;
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
}

export const TUNE_SECONDS = 6;
export const RAMP = " .:-=+*#%@";
// Junk is what a bad packet decodes to: hex, half-width katakana, line noise.
const JUNK = "0123456789ABCDEFｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ<>/\\|[]{}";
const WORD = "ultrasonics";
const KATAKANA = "ソニックス";
const GAIN = 1.2;
const RECOVERY = 1.3;
const CHROMA = 3;
const TEAR = 3;
const NOISE = 0.05;
const JP_RATIO = 0.23;

interface Look {
	gamma: number;
	max: number;
	chromaMax: number;
	magenta: boolean;
}
interface Point {
	x: number;
	y: number;
}
interface Burst {
	p: Point;
	amt: number;
	left: number;
	dur: number;
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
	readonly cw: number;
	readonly ch: number;
	readonly cols: number;
	readonly rows: number;
	private readonly sat: Float32Array;
	private readonly w1: number;
	private readonly hw: number;
	private readonly hh: number;
	private field: Float32Array;
	private next: Float32Array;
	private readonly r1: Float32Array;
	private readonly r2: Float32Array;
	private readonly r3: Float32Array;
	private readonly tearX: Float32Array;
	private readonly rowC: Float32Array;

	constructor(
		readonly face: Face,
		readonly cell: number,
		readonly top: number,
		height: number,
		width: number,
		readonly look: Look,
		readonly seed: number,
		readonly scale: number,
		readonly floor: boolean,
		glyphs: Glyphs,
		texts: MaskRequest["texts"],
	) {
		this.cw = cell * 0.6;
		this.ch = cell;
		this.cols = Math.ceil(width / this.cw) + 1;
		this.rows = Math.ceil(height / this.ch);
		this.hw = Math.round(this.cols * this.cw * scale);
		this.hh = Math.round(this.rows * this.ch * scale);
		const alpha = glyphs.mask({ width: this.hw, height: this.hh, scale, face, texts });
		// A summed-area table makes any shifted cell's coverage O(1).
		this.w1 = this.hw + 1;
		this.sat = new Float32Array(this.w1 * (this.hh + 1));
		for (let y = 0; y < this.hh; y++) {
			let run = 0;
			for (let x = 0; x < this.hw; x++) {
				run += alpha[y * this.hw + x] ?? 0;
				this.sat[(y + 1) * this.w1 + x + 1] = (this.sat[y * this.w1 + x + 1] ?? 0) + run;
			}
		}
		const n = this.cols * this.rows;
		this.field = new Float32Array(n);
		this.next = new Float32Array(n);
		this.r1 = new Float32Array(n);
		this.r2 = new Float32Array(n);
		this.r3 = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			this.r1[i] = hash(seed + i * 3 + 1);
			this.r2[i] = hash(seed + i * 3 + 7919);
			this.r3[i] = hash(seed + i * 3 + 104729);
		}
		this.tearX = new Float32Array(this.rows);
		this.rowC = new Float32Array(this.rows);
	}

	/** Mean alpha of a cell-sized rect at cell (i, j), shifted by (dx, dy) CSS pixels. */
	private cov(i: number, j: number, dx: number, dy: number) {
		const S = this.scale;
		const s = this.sat;
		const w = this.w1;
		let x0 = Math.round((i * this.cw + dx) * S);
		let y0 = Math.round((j * this.ch + dy) * S);
		let x1 = x0 + Math.round(this.cw * S);
		let y1 = y0 + Math.round(this.ch * S);
		const area = (x1 - x0) * (y1 - y0);
		x0 = clamp(x0, 0, this.hw);
		x1 = clamp(x1, 0, this.hw);
		y0 = clamp(y0, 0, this.hh);
		y1 = clamp(y1, 0, this.hh);
		if (x1 <= x0 || y1 <= y0) return 0;
		const at = (x: number, y: number) => s[y * w + x] ?? 0;
		return (at(x1, y1) - at(x1, y0) - at(x0, y1) + at(x0, y0)) / area;
	}

	/** Interference is wide and short (scanline-shaped) and ragged with noise, never a round brush. */
	deposit(p: Point, amt: number, t: number) {
		const rx = 42 / this.cw;
		const ry = 17 / this.ch;
		const ci = p.x / this.cw;
		const cj = (p.y - this.top) / this.ch;
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
				const g = Math.exp(-(dx * dx + dy * dy));
				if (g < 0.01) continue;
				const k = j * this.cols + i;
				const x = i * this.cw;
				const y = this.top + j * this.ch;
				const ragged = 0.3 + 0.7 * noise(x * 0.037, y * 0.08 + t * 3);
				this.field[k] = Math.min(1, (this.field[k] ?? 0) + amt * g * ragged);
			}
	}

	step(t: number, dt: number) {
		const { cols, rows, field, next } = this;
		// A damaged line bleeds along itself and decays towards a clean signal.
		const k = Math.exp(-dt / RECOVERY);
		const side = Math.min(0.12, (0.12 * this.cw) / 6);
		for (let j = 0; j < rows; j++)
			for (let i = 0; i < cols; i++) {
				const n = j * cols + i;
				const l = i > 0 ? (field[n - 1] ?? 0) : 0;
				const r = i < cols - 1 ? (field[n + 1] ?? 0) : 0;
				next[n] = ((field[n] ?? 0) * (1 - 2 * side) + (l + r) * side) * k;
			}
		this.field = next;
		this.next = field;
		// Rows share a smooth noise in pixel space, so a band slips together across both grids.
		for (let j = 0; j < rows; j++) {
			let mx = 0;
			for (let i = 0; i < cols; i++) mx = Math.max(mx, this.field[j * cols + i] ?? 0);
			this.rowC[j] = mx;
		}
		for (let j = 0; j < rows; j++) {
			const c =
				((this.rowC[Math.max(0, j - 1)] ?? 0) +
					2 * (this.rowC[j] ?? 0) +
					(this.rowC[Math.min(rows - 1, j + 1)] ?? 0)) /
				4;
			const target = c * c * TEAR * (noise((this.top + j * this.ch) * 0.045, t * 1.7) * 2 - 1);
			this.tearX[j] = lerp(this.tearX[j] ?? 0, target, 1 - Math.exp(-dt * 18));
		}
	}

	draw(t: number, hum: { y: number; w: number }, logo: Mosaic): FrameLayer {
		const { cols, rows, cw, ch, look, top } = this;
		const tuned = logo.dial >= 1;
		const cells: Cell[] = [];
		for (let j = 0; j < rows; j++) {
			const sx = this.tearX[j] ?? 0;
			const y = top + j * ch;
			// The hum bar: a soft band rolling slowly down the picture, where the flicker is stronger.
			const h = Math.exp(-(((y - hum.y) / hum.w) ** 2));
			for (let i = 0; i < cols; i++) {
				const n = j * cols + i;
				const c = Math.min(1, this.field[n] ?? 0);
				const r1 = this.r1[n] ?? 0;
				const r2 = this.r2[n] ?? 0;
				const x = i * cw;
				// q: how well this point is tuned. m: how far off it still is.
				const q = tuned ? 1 : logo.tunedAt(x + cw / 2, y + ch / 2, t);
				const m = 1 - q;
				// Signal strength rises with tuning, so values climb from black rather than fading in.
				const amp = q ** 1.4;
				// Off-station the picture swims: a smooth warp, coherent between neighbours.
				let wx = 0;
				let wy = 0;
				if (m > 0) {
					wx = (noise(x * 0.011 + 5, y * 0.018 + t * 0.25) * 2 - 1) * m * 38;
					wy = (noise(x * 0.011 + 50, y * 0.018 + t * 0.25 + 9) * 2 - 1) * m * 12;
				}
				// At rest the split is about a cell; interference and mistuning both widen it.
				const d = cw * 1.1 + c * CHROMA + m * 22;
				const dy = ch * 0.45 + c * CHROMA * 0.1 + m * 5;
				// Each cell has its own loss threshold, so loss and recovery are staggered, never a fade.
				const loss = clamp((c - 0.06 - r1 * 0.5) * 2.4);
				const fl = this.cov(i, j, sx + wx, wy) * (1 - loss);
				let idx = 0;
				let tone: Tone | null = null;
				// Dithered by the cell's own random, so a weak signal shows as sparse low glyphs.
				if (fl > 0.05)
					idx = Math.floor(Math.min(1, fl * 1.2) ** look.gamma * look.max * amp + r1 * 0.999);
				if (idx >= 1) tone = "face";
				else {
					// Sampling right-and-up draws the teal copy down-left, as v1.
					const tl = this.cov(i, j, sx + wx + d, wy - dy);
					const mg = look.magenta ? this.cov(i, j, sx + wx - d, wy + dy) : 0;
					const v = Math.max(tl, mg);
					// Chroma tops out lower on the ramp so the face always reads first.
					if (v > 0.08) {
						idx = Math.floor(v * look.chromaMax * amp + r1 * 0.999);
						if (idx >= 1) tone = tl >= mg ? "teal" : "magenta";
					}
				}
				// Static gathers at the tuning front and under interference, falling away from the logo.
				if (!tone && this.floor && (q < 1 || c > 0.02)) {
					const pf = (0.07 * 4 * q * m + c * 0.05) * logo.proxAt(x, y);
					if (hash(n * 13 + Math.floor(t * 12 + r1 * 12)) < pf) {
						const s = hash(n * 7 + Math.floor(t * 12 + r2 * 12));
						idx = 1 + Math.floor(s * s * (1 + 3 * q));
						tone = s < 0.6 ? "face" : s < 0.8 ? "teal" : "magenta";
					}
				}
				if (!tone) continue;
				// Analogue flicker: each cell re-rolls about ten times a second, out of step with its
				// neighbours, usually one notch down the ramp, occasionally one up.
				const roll = hash(n * 17 + this.seed + Math.floor(t * 10 + (this.r3[n] ?? 0) * 10));
				const p = NOISE * (0.07 + 0.18 * h);
				if (roll < p) idx -= 1;
				else if (roll > 1 - p * 0.35) idx += 1;
				let glyph = RAMP[clamp(idx, 1, 9)] as string;
				if (c > 0.42 + r2 * 0.5 || roll < p * 0.04) {
					glyph = JUNK[
						Math.floor(hash(n * 31 + Math.floor(t * 7 + r1 * 7)) * JUNK.length)
					] as string;
					if (hash(n + Math.floor(t * 3)) < c * 0.35) tone = tone === "teal" ? "magenta" : "teal";
				}
				cells.push({ col: i, row: j, glyph, tone });
			}
		}
		return { face: this.face, cell: this.cell, top, cols, rows, cells };
	}
}

export type Mosaic = ReturnType<typeof createMosaic>;

export function createMosaic({
	seed,
	width: W,
	height: H,
	cell,
	glyphs,
	reduced = false,
	idleGlitches = true,
}: MosaicOptions) {
	const tw = Math.min(1000, W - 32) * 0.88;
	const T = (100 * tw) / glyphs.measure(WORD, "word", 100);
	const K = T * JP_RATIO;
	const fine = Math.max(3, Math.round(cell * 0.45 * 10) / 10);
	// The lockup is centred in the picture: the name, then the katakana under it.
	const yWord = H / 2 - (T + 1.3 * K) / 2 + 0.45 * T;
	const yJp = yWord + T * 0.55 + K * 0.7;
	const base = Math.imul(seed, 7919);
	// The wordmark's grid covers the whole picture, so the static and the tuning have no edges.
	const word = new Layer(
		"word",
		cell,
		0,
		H + cell,
		W,
		// The face leans dense (a low gamma) so the name reads at a glance.
		{ gamma: 0.55, max: 9, chromaMax: 6, magenta: true },
		base,
		1,
		true,
		glyphs,
		[{ text: WORD, size: T, x: W / 2, y: yWord + T * 0.06 }],
	);
	// The katakana has a finer grid of its own: on the wordmark's cells it would have three rows.
	const jpTop = yJp - K;
	const span = tw * 0.96;
	const left = (W - span) / 2 + K / 2;
	const jp = new Layer(
		"katakana",
		fine,
		jpTop,
		K * 2,
		W,
		// Capped at "#", so it sits under the name rather than beside it.
		{ gamma: 0.7, max: 7, chromaMax: 5, magenta: false },
		base + 1e6,
		2,
		false,
		glyphs,
		[...KATAKANA].map((text, k) => ({ text, size: K, x: left + (k * (span - K)) / 4, y: K })),
	);
	const layers = [word, jp];
	const boxTop = yWord - T * 0.45;
	const boxBottom = yJp + K * 0.6;
	const box = { cx: W / 2, cy: (boxTop + boxBottom) / 2, hw: tw / 2, hh: (boxBottom - boxTop) / 2 };
	let draws = 0;
	const random = () => hash(base + 31 * ++draws);
	let t0: number | null = null;
	let pointer: Point | null = null;
	let prev: Point | null = null;
	let pending: Burst[] = [];
	let nextGlitch = TUNE_SECONDS + 2 + random() * 3;
	const deposit = (p: Point, amt: number, t: number) => {
		for (const l of layers) l.deposit(p, amt, t);
	};

	const mosaic = {
		width: W,
		height: H,
		dial: reduced ? 1 : 0,
		/** How tuned (0–1) the point is: the dial plus a slow drifting offset, so patches lock at different times. */
		tunedAt(x: number, y: number, t: number) {
			const o =
				noise(x * 0.0035 + 11, y * 0.006 + t * 0.04) * 0.65 +
				noise(x * 0.011 + 3, y * 0.017 - t * 0.07) * 0.35;
			return smooth(mosaic.dial * 1.65 - 0.25 + 0.7 * (o - 0.5) + 0.25 * mosaic.proxAt(x, y));
		},
		/** 1 on the logo, falling to 0 about 130px from its box. */
		proxAt(x: number, y: number) {
			const dx = Math.max(0, Math.abs(x - box.cx) - box.hw);
			const dy = Math.max(0, Math.abs(y - box.cy) - box.hh);
			return Math.exp(-(dx * dx + dy * dy) / (130 * 130));
		},
		/** Where the cursor is over the picture, or null once it has left. */
		pointer(p: Point | null) {
			pointer = p;
			if (!p) prev = null;
		},
		/** A click: a short, strong burst of interference. */
		press(p: Point) {
			pointer = p;
			pending.push({ p, amt: 0.9, left: 0.14, dur: 0.14 });
		},
		/** A line glitch across the name. */
		glitch() {
			const y = yWord + (random() - 0.5) * T * 0.9;
			for (let x = 24; x < W; x += 54)
				pending.push({ p: { x, y }, amt: 0.35, left: 0.18, dur: 0.18 });
		},
		step(t: number, dt: number) {
			if (reduced) return;
			// The dial moves from the first frame and eases out, so the picture never snaps into place.
			if (t0 === null) t0 = t;
			mosaic.dial = 1 - (1 - clamp((t - t0) / TUNE_SECONDS)) ** 2.2;
			for (const l of layers) l.step(t, dt);
			if (pointer) {
				const q = prev ?? pointer;
				const dist = Math.hypot(pointer.x - q.x, pointer.y - q.y);
				const speed = clamp(dist / 30);
				const steps = Math.max(1, Math.ceil(dist / 6));
				for (let s = 1; s <= steps; s++)
					deposit(
						{ x: lerp(q.x, pointer.x, s / steps), y: lerp(q.y, pointer.y, s / steps) },
						(GAIN * 0.5 * speed) / steps,
						t,
					);
				// A cursor held still is a weak, steady source: the picture never quite settles under it.
				deposit(pointer, GAIN * 0.045 * dt * 60 * (1 - speed), t);
				prev = { ...pointer };
			}
			// Bursts ramp in over a few frames rather than popping.
			for (const b of pending) {
				const a = Math.min(b.left, dt);
				b.left -= a;
				deposit(b.p, (b.amt * GAIN * a) / b.dur, t);
			}
			pending = pending.filter((b) => b.left > 0);
			if (idleGlitches && t > nextGlitch && mosaic.dial >= 1) {
				nextGlitch = t + 3.5 + random() * 6;
				mosaic.glitch();
			}
		},
		frame(t: number): Frame {
			const hum = { y: (((t * 0.09) % 1.6) - 0.3) * H, w: H * 0.14 };
			return { width: W, height: H, layers: layers.map((l) => l.draw(t, hum, mosaic)) };
		},
	};
	return mosaic;
}
