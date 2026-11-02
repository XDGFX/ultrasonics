import { afterEach, describe, expect, test } from "bun:test";
import { mountApp, settle } from "../test/mount-app.ts";
import type { AppletDraft } from "./api-client.ts";
import { deduplicate, plex, spotify } from "./fake-catalogue.ts";

afterEach(() => {
	document.body.innerHTML = "";
});

const draft: AppletDraft = {
	name: "weekly",
	enabled: true,
	definition: {
		inputs: [{ plugin: "spotify", settings: { source: "saved" } }],
		modifiers: [],
		outputs: [{ plugin: "plex", settings: {} }],
	},
};

const steps = (wrapper: Awaited<ReturnType<typeof mountApp>>["wrapper"]) =>
	wrapper.findAll("ol.steps > li");

describe("first run", () => {
	test("stands in for the applet list while the account has no applets", async () => {
		const { router } = await mountApp("/");
		expect(router.currentRoute.value.name).toBe("first-run");
	});

	test("opens on the mosaic, with the static lockup standing in below full size", async () => {
		const { wrapper } = await mountApp("/welcome");
		const logos = wrapper.findAll('[role="img"][aria-label="ultrasonics"]');
		expect(logos.map((logo) => logo.attributes("data-logo"))).toEqual(["mosaic", "lockup"]);
	});

	test("has one step per service the catalogue uses, then making an applet", async () => {
		const { wrapper } = await mountApp("/welcome", { plugins: [spotify, deduplicate, plex] });
		expect(steps(wrapper).map((step) => step.attributes("data-step"))).toEqual([
			"spotify",
			"plex",
			"applet",
		]);
		expect(steps(wrapper).map((step) => step.get("a").attributes("href"))).toEqual([
			"/services/spotify",
			"/services/plex",
			"/applets/new",
		]);
	});

	test("ticks a connected service and highlights the next step, without locking the rest", async () => {
		const { wrapper } = await mountApp("/welcome", { grants: { spotify: { kind: "connected" } } });
		const [first, second, third] = steps(wrapper);
		expect(first?.attributes("data-done")).toBe("true");
		expect(second?.attributes("data-done")).toBe("false");
		expect(second?.attributes("aria-current")).toBe("step");
		expect(first?.attributes("aria-current")).toBeUndefined();
		expect(third?.get("a").attributes("aria-disabled")).toBeUndefined();
	});

	test("gives way to the list once an applet exists", async () => {
		const { router, api } = await mountApp("/welcome");
		await api.applets.create(draft);
		await router.push("/settings");
		await router.push("/welcome");
		await settle();
		expect(router.currentRoute.value.name).toBe("applets");
	});
});
