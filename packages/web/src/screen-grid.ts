import type { Point } from "./mosaic.ts";

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}
export interface Viewport {
	width: number;
	height: number;
	scrollX: number;
	scrollY: number;
}

/**
 * Where the mosaic's canvas goes, relative to the hero's slot, so its grid covers the whole first
 * screen (ADR-0027 §2) and scrolls with the page; the logo sits on the slot's centre.
 */
export function screenGrid(slot: Rect, viewport: Viewport): Rect & { anchor: Point } {
	const left = slot.left + viewport.scrollX;
	const top = slot.top + viewport.scrollY;
	return {
		left: -left,
		top: -top,
		width: viewport.width,
		height: viewport.height,
		anchor: { x: left + slot.width / 2, y: top + slot.height / 2 },
	};
}
