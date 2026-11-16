import { afterEach, describe, expect, test } from "bun:test";
import { mountApp, settle } from "../test/mount-app.ts";
import type { Applet } from "./api-client.ts";
import { formatWhen } from "./clock.ts";
import { MARK } from "./logo-assets.ts";

const applet: Applet = {
	id: "a1",
	name: "weekly",
	enabled: true,
	definition: {
		inputs: [{ plugin: "spotify", settings: { source: "all" } }],
		modifiers: [],
		outputs: [{ plugin: "plex", settings: {} }],
	},
	schedule: null,
	hasWebhook: false,
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("the shell", () => {
	test("shows the chroma-pixel mark and links to applets and settings from the rail", async () => {
		const { wrapper } = await mountApp("/", { applets: [applet] });
		const rail = wrapper.get("nav.rail");
		expect(rail.get('[aria-label="ultrasonics"] img').attributes("src")).toBe(`/${MARK}`);
		expect(rail.findAll("a").map((link) => link.attributes("href"))).toEqual(
			expect.arrayContaining(["/", "/settings"]),
		);
	});

	test("marks the rail entry the current screen belongs under", async () => {
		const { wrapper } = await mountApp("/services/plex", { applets: [applet] });
		const active = wrapper.findAll('nav.rail a[data-active="true"]');
		expect(active.map((link) => link.attributes("href"))).toEqual(["/settings"]);
	});

	test("shows where the user is in the breadcrumb bar", async () => {
		const { wrapper } = await mountApp("/applets/a1", { applets: [applet] });
		const crumbs = wrapper.get('nav[aria-label="breadcrumb"]');
		expect(crumbs.findAll("li").map((crumb) => crumb.text())).toEqual(["applets", "weekly"]);
		expect(crumbs.get("a").attributes("href")).toBe("/");
	});

	test("shows the exposure banner, with where and when, until it is dismissed", async () => {
		const exposure = { at: Date.now() - 60_000, address: "203.0.113.9" };
		const { wrapper } = await mountApp("/", { applets: [applet], exposure });
		const banner = wrapper.get('[data-banner="exposed"]');
		expect(banner.get('[data-exposure="address"]').text()).toBe(exposure.address);
		expect(banner.get('[data-exposure="at"]').text()).toBe(formatWhen(exposure.at));

		await banner.get('[data-action="dismiss-exposure"]').trigger("click");
		await settle();
		expect(wrapper.find('[data-banner="exposed"]').exists()).toBe(false);
	});

	test("shows no exposure banner when nothing public was seen", async () => {
		const { wrapper } = await mountApp("/", { applets: [applet] });
		expect(wrapper.find('[data-banner="exposed"]').exists()).toBe(false);
	});
});

describe("the router", () => {
	test("has a route for every phase 1 screen", async () => {
		const { router } = await mountApp("/", { applets: [applet] });
		const names = [
			"/welcome",
			"/",
			"/applets/new",
			"/applets/a1",
			"/runs/r1",
			"/settings",
			"/services/spotify",
			"/services/plex",
		].map((path) => router.resolve(path).name);
		expect(names).toEqual([
			"first-run",
			"applets",
			"new-applet",
			"builder",
			"run",
			"settings",
			"wizard",
			"wizard",
		]);
	});
});
