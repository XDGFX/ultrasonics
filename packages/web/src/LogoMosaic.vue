<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { canvasGlyphs, drawFrame, loadLogoFonts } from "./canvas-glyphs.ts";
import { createMosaic, type Mosaic } from "./mosaic.ts";
import { screenGrid } from "./screen-grid.ts";

const place = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
let mosaic: Mosaic | null = null;
let frameId = 0;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let motion: MediaQueryList | undefined;
let layout: ResizeObserver | undefined;
let placed = "";
let alive = true;
// Presses on these are the page's own, not interference.
const INTERACTIVE =
	"a, button, input, select, textarea, label, summary, [role=button], [contenteditable]";

/** Lays the grid out again, restarting the tune-in only when it actually moved or `force`d. */
function build(force = false) {
	const el = place.value;
	const c = canvas.value;
	const g = c?.getContext("2d");
	// Hidden below full size, where the static lockup stands in.
	const visible = el && c && g && el.clientWidth > 0;
	const page = document.documentElement;
	const grid = visible
		? screenGrid(el.getBoundingClientRect(), {
				width: page.clientWidth,
				height: page.clientHeight,
				scrollX,
				scrollY,
			})
		: null;
	const key = JSON.stringify(grid);
	if (!force && key === placed) return;
	placed = key;
	cancelAnimationFrame(frameId);
	mosaic = null;
	if (!grid || !c || !g) return;
	Object.assign(c.style, {
		left: `${grid.left}px`,
		top: `${grid.top}px`,
		width: `${grid.width}px`,
		height: `${grid.height}px`,
	});
	const dpr = devicePixelRatio || 1;
	c.width = grid.width * dpr;
	c.height = grid.height * dpr;
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	const reduced = motion?.matches ?? false;
	const m = createMosaic({
		seed: 1,
		width: grid.width,
		height: grid.height,
		cell: 10,
		glyphs: canvasGlyphs,
		reduced,
		anchor: grid.anchor,
	});
	mosaic = m;
	if (reduced) {
		drawFrame(g, m.frame(0));
		return;
	}
	let last: number | null = null;
	const tick = (now: number) => {
		const t = now / 1000;
		m.step(t, Math.min(0.05, last === null ? 1 / 60 : t - last));
		last = t;
		drawFrame(g, m.frame(t));
		frameId = requestAnimationFrame(tick);
	};
	frameId = requestAnimationFrame(tick);
}

const rebuildNow = () => build(true);
const rebuildSoon = () => {
	clearTimeout(resizeTimer);
	resizeTimer = setTimeout(() => build(), 200);
};
const at = (e: PointerEvent) => {
	const r = canvas.value?.getBoundingClientRect();
	return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
};
// The grid lies behind the page, so the cursor interferes wherever it is on screen.
const move = (e: PointerEvent) => mosaic?.pointer(at(e));
const press = (e: PointerEvent) => {
	if (!(e.target instanceof Element && e.target.closest(INTERACTIVE)))
		mosaic?.press(at(e));
};
const leave = () => mosaic?.pointer(null);

onMounted(async () => {
	if (!canvas.value?.getContext("2d")) return;
	await loadLogoFonts();
	if (!alive) return;
	motion = matchMedia("(prefers-reduced-motion: reduce)");
	motion.addEventListener("change", rebuildNow);
	addEventListener("resize", rebuildSoon);
	// A late banner or scrollbar moves the place without resizing the window.
	layout = new ResizeObserver(rebuildSoon);
	layout.observe(document.body);
	addEventListener("pointermove", move);
	addEventListener("pointerdown", press);
	document.documentElement.addEventListener("pointerleave", leave);
	build(true);
});
onBeforeUnmount(() => {
	alive = false;
	cancelAnimationFrame(frameId);
	clearTimeout(resizeTimer);
	motion?.removeEventListener("change", rebuildNow);
	removeEventListener("resize", rebuildSoon);
	layout?.disconnect();
	removeEventListener("pointermove", move);
	removeEventListener("pointerdown", press);
	document.documentElement.removeEventListener("pointerleave", leave);
});
</script>

<template>
	<div ref="place" class="mosaic" role="img" aria-label="ultrasonics" data-logo="mosaic">
		<canvas ref="canvas"></canvas>
	</div>
</template>

<style scoped>
/* This holds the logo's place in the page; the canvas spreads from it over the whole screen, behind everything. */
.mosaic { position: relative; }
canvas { position: absolute; z-index: -1; display: block; pointer-events: none; }
</style>
