<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { canvasGlyphs, DARK, drawFrame, loadLogoFonts } from "./canvas-glyphs.ts";
import { createMosaic, type Mosaic } from "./mosaic.ts";

const host = ref<HTMLDivElement>();
const canvas = ref<HTMLCanvasElement>();
let mosaic: Mosaic | null = null;
let frameId = 0;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
let alive = true;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function build() {
	const el = host.value;
	const c = canvas.value;
	const g = c?.getContext("2d");
	cancelAnimationFrame(frameId);
	mosaic = null;
	// Hidden below full size, where the static lockup stands in.
	if (!el || !c || !g || el.clientWidth === 0) return;
	const width = el.clientWidth;
	const height = el.clientHeight;
	const dpr = devicePixelRatio || 1;
	c.width = width * dpr;
	c.height = height * dpr;
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	const m = createMosaic({
		seed: 1,
		width,
		height,
		cell: width > 760 ? 10 : 7,
		glyphs: canvasGlyphs,
		reduced: reduced(),
	});
	mosaic = m;
	if (reduced()) {
		drawFrame(g, m.frame(0), DARK);
		return;
	}
	let last: number | null = null;
	const tick = (now: number) => {
		const t = now / 1000;
		m.step(t, Math.min(0.05, last === null ? 1 / 60 : t - last));
		last = t;
		drawFrame(g, m.frame(t), DARK);
		frameId = requestAnimationFrame(tick);
	};
	frameId = requestAnimationFrame(tick);
}

const at = (e: PointerEvent) => {
	const r = canvas.value?.getBoundingClientRect();
	return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
};
const move = (e: PointerEvent) => mosaic?.pointer(at(e));
const press = (e: PointerEvent) => mosaic?.press(at(e));
const leave = () => mosaic?.pointer(null);

onMounted(async () => {
	if (!canvas.value?.getContext("2d")) return;
	await loadLogoFonts();
	if (!alive) return;
	build();
	observer = new ResizeObserver(() => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(build, 200);
	});
	if (host.value) observer.observe(host.value);
});
onBeforeUnmount(() => {
	alive = false;
	cancelAnimationFrame(frameId);
	clearTimeout(resizeTimer);
	observer?.disconnect();
});
</script>

<template>
	<div ref="host" class="mosaic" role="img" aria-label="ultrasonics" data-logo="mosaic">
		<canvas ref="canvas" @pointermove="move" @pointerdown="press" @pointerleave="leave"></canvas>
	</div>
</template>

<style scoped>
.mosaic { position: relative; background: #111; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: crosshair; touch-action: none; }
</style>
