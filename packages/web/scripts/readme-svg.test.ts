import { describe, expect, test } from "bun:test";
import type { Frame } from "../src/mosaic.ts";
import { readmeSvg } from "./readme-svg.ts";

const frame = (glyph: string): Frame => ({
	width: 60,
	height: 20,
	layers: [
		{
			face: "word",
			cell: 10,
			top: 0,
			cols: 10,
			rows: 2,
			cells: [
				{ col: 2, row: 0, glyph, tone: "face" },
				{ col: 3, row: 0, glyph: "<", tone: "face" },
				{ col: 1, row: 1, glyph: ":", tone: "teal" },
			],
		},
	],
});

const frames = {
	tuneIn: [frame("."), frame("=")],
	loop: [frame("#"), frame("%"), frame("@")],
	still: frame("@"),
	fps: 10,
};
const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");

describe("the README SVG", () => {
	const doc = parse(readmeSvg({ ...frames, theme: "dark" }));
	const style = doc.querySelector("style")?.textContent ?? "";

	test("plays the tune-in once, then loops the flicker", () => {
		expect([...doc.querySelectorAll("g.tune")].map((g) => g.getAttribute("style"))).toEqual([
			"animation-delay:0s",
			"animation-delay:0.1s",
		]);
		expect([...doc.querySelectorAll("g.loop")].map((g) => g.getAttribute("style"))).toEqual([
			"animation-delay:0.2s",
			"animation-delay:0.3s",
			"animation-delay:0.4s",
		]);
		expect(style).toMatch(/\.tune\s*\{\s*animation:[^}]*0\.1s step-end\s*\}/);
		expect(style).toMatch(/\.loop\s*\{[^}]*animation:[^};]*0\.3s[^};]*infinite/);
	});

	test("shows only the still frame under reduced motion", () => {
		expect(doc.querySelector("g.still")?.getAttribute("style")).toBeNull();
		expect(style).toMatch(
			/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*animation:\s*none[^@]*\.still\s*\{\s*visibility:\s*visible/,
		);
	});

	test("draws each row of a tone as one text, a position per glyph", () => {
		const first = doc.querySelector("g.tune text.face");
		expect(first?.textContent).toBe(".<");
		expect(first?.getAttribute("x")).toBe("12 18");
		expect(doc.querySelector("g.tune text.teal")?.getAttribute("x")).toBe("6");
	});

	test("has no background, and a face colour for the theme it is made for", () => {
		expect(doc.querySelector("rect")).toBeNull();
		expect(style).toContain(".face{fill:#fff}");
		const light = parse(readmeSvg({ ...frames, theme: "light" })).querySelector(
			"style",
		)?.textContent;
		expect(light).toContain(".face{fill:#111}");
	});

	test("crops to the window it is given", () => {
		const cropped = parse(readmeSvg({ ...frames, theme: "dark", crop: { x: 6, width: 30 } }));
		expect(cropped.documentElement.getAttribute("viewBox")).toBe("6 0 30 20");
		expect(cropped.documentElement.getAttribute("width")).toBe("30");
	});
});
