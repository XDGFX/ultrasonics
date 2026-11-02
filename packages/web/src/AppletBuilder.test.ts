import { afterEach, describe, expect, test } from "bun:test";
import type { Component } from "@ultrasonics/plugin-sdk";
import { mountApp, settle } from "../test/mount-app.ts";
import type { FakeApplet, FakeSeed } from "./fake-api.ts";

afterEach(() => {
	document.body.innerHTML = "";
});

type Mounted = Awaited<ReturnType<typeof mountApp>>;
type Wrapper = Mounted["wrapper"];

const applet: FakeApplet = {
	id: "a1",
	name: "weekly",
	enabled: true,
	definition: {
		inputs: [{ plugin: "spotify", settings: { source: "chosen", names: "discover weekly" } }],
		modifiers: [{ plugin: "deduplicate", settings: {} }],
		outputs: [{ plugin: "plex", settings: { update: "replace" } }],
	},
	schedule: null,
	hasWebhook: false,
};

const open = (seed: Partial<FakeSeed> = {}, path = "/applets/a1") =>
	mountApp(path, { applets: [applet], grants: { plex: { kind: "connected" } }, ...seed });

const nodes = (wrapper: Wrapper, component: Component) =>
	wrapper.findAll(`[data-column="${component}"] [data-node]`);

const node = (wrapper: Wrapper, component: Component, index: number) => {
	const found = nodes(wrapper, component)[index];
	if (!found) throw new Error(`no ${component} node ${index}`);
	return found;
};

async function click(wrapper: Wrapper, selector: string, label?: string) {
	const found = wrapper
		.findAll(selector)
		.find((candidate) => label === undefined || candidate.text() === label);
	if (!found) throw new Error(`nothing matches ${selector} ${label ?? ""}`);
	await found.trigger("click");
	await settle();
}

const sentence = (wrapper: Wrapper) => wrapper.get(".sentence").text();

async function save(wrapper: Wrapper) {
	await click(wrapper, "button", "save");
}

describe("the builder", () => {
	test("reads the applet as its sentence over the four columns, kept current as it changes", async () => {
		const { wrapper } = await open();
		expect(wrapper.findAll(".col .h").map((heading) => heading.text())).toEqual([
			"when:",
			"inputs:",
			"modifiers:",
			"outputs:",
		]);
		expect(sentence(wrapper)).toBe("manual only: take spotify, deduplicate it, and put it in plex");
		await click(wrapper, '[data-column="modifiers"] [data-node] button[title="remove"]');
		expect(sentence(wrapper)).toBe("manual only: take spotify, and put it in plex");
	});

	test("shows each node's name, version and a one-line summary", async () => {
		const { wrapper } = await open();
		const spotify = node(wrapper, "inputs", 0);
		expect(spotify.get(".t").text()).toContain("spotify");
		expect(spotify.get(".v").text()).toBe("v2.0.0");
		expect(spotify.get(".d").text()).toBe("chosen · discover weekly");
		expect(node(wrapper, "modifiers", 0).get(".d").text()).toBe("removes repeated songs");
	});

	test("offers only the plugins implementing a column's component", async () => {
		const { wrapper } = await open();
		const offered = async (component: Component) => {
			await click(wrapper, `[data-column="${component}"] [data-add]`);
			return wrapper.findAll(".panel [data-offer]").map((offer) => offer.attributes("data-offer"));
		};
		expect(await offered("inputs")).toEqual(["spotify"]);
		expect(await offered("modifiers")).toEqual(["deduplicate"]);
		expect(await offered("outputs")).toEqual(["plex"]);
	});

	test("adds a plugin with its defaults, reorders and removes nodes, and saves the order", async () => {
		const { wrapper, api } = await open();
		await click(wrapper, '[data-column="inputs"] [data-add]');
		await click(wrapper, ".panel [data-offer]");
		expect(nodes(wrapper, "inputs")).toHaveLength(2);

		await node(wrapper, "inputs", 0).get('button[title="move down"]').trigger("click");
		await click(wrapper, '[data-column="modifiers"] [data-node] button[title="remove"]');
		await save(wrapper);

		const saved = await api.applets.get("a1");
		expect(saved.definition.inputs).toEqual([
			{ plugin: "spotify", settings: { source: "saved", includeLiked: false } },
			{ plugin: "spotify", settings: { source: "chosen", names: "discover weekly" } },
		]);
		expect(saved.definition.modifiers).toEqual([]);
	});

	test("opens a node's instance settings in the side panel, and saves what is edited there", async () => {
		const { wrapper, api } = await open();
		await click(wrapper, '[data-column="inputs"] [data-node] .select');
		const names = wrapper.get('.panel input[name="names"]');
		expect((names.element as HTMLInputElement).value).toBe("discover weekly");
		await names.setValue("release radar");
		expect(node(wrapper, "inputs", 0).get(".d").text()).toBe("chosen · release radar");
		await save(wrapper);
		expect((await api.applets.get("a1")).definition.inputs[0]?.settings).toEqual({
			source: "chosen",
			names: "release radar",
		});
	});

	test("says a node with no settings has none", async () => {
		const { wrapper } = await open();
		await click(wrapper, '[data-column="modifiers"] [data-node] .select');
		expect(wrapper.get(".panel").text()).toContain("no settings.");
		expect(wrapper.find(".panel form").exists()).toBe(false);
	});

	test("links a node whose service isn't connected to its wizard", async () => {
		const { wrapper } = await open();
		expect(node(wrapper, "inputs", 0).find("[data-needs-service]").exists()).toBe(true);
		expect(node(wrapper, "outputs", 0).find("[data-needs-service]").exists()).toBe(false);
		await click(wrapper, '[data-column="inputs"] [data-node] .select');
		expect(wrapper.get(".panel [data-service-link]").attributes("href")).toBe("/services/spotify");
	});

	test("places each issue a save returns on its node and field", async () => {
		const { wrapper, api } = await open();
		await click(wrapper, '[data-column="inputs"] [data-node] .select');
		await wrapper.get('.panel input[name="names"]').setValue("");
		await click(wrapper, '[data-column="outputs"] [data-node] .select');
		await save(wrapper);

		expect(node(wrapper, "inputs", 0).attributes("data-issues")).toBe("1");
		expect(node(wrapper, "outputs", 0).attributes("data-issues")).toBe("0");
		await click(wrapper, '[data-column="inputs"] [data-node] .select');
		const field = wrapper.get('.panel input[name="names"]').element.closest(".field");
		expect(field?.querySelector(".issue")?.textContent).toBeTruthy();
		expect((await api.applets.get("a1")).definition.inputs[0]?.settings).toEqual(
			applet.definition.inputs[0]?.settings,
		);
	});

	test("edits the name and the enabled toggle, and save sends them", async () => {
		const { wrapper, api } = await open();
		await wrapper.get('input[name="applet-name"]').setValue("monday mix");
		await wrapper.get('input[name="applet-enabled"]').setValue(false);
		await save(wrapper);
		expect(await api.applets.get("a1")).toMatchObject({ name: "monday mix", enabled: false });
	});

	test("creates a new applet on save and moves to its address", async () => {
		const { wrapper, api, router } = await mountApp("/applets/new");
		await click(wrapper, '[data-column="inputs"] [data-add]');
		await click(wrapper, ".panel [data-offer]");
		await click(wrapper, '[data-column="outputs"] [data-add]');
		await click(wrapper, ".panel [data-offer]");
		await save(wrapper);
		const [created] = await api.applets.list();
		expect(created?.definition.outputs.map((slot) => slot.plugin)).toEqual(["plex"]);
		expect(router.currentRoute.value.path).toBe(`/applets/${created?.id}`);
	});

	describe("the schedule", () => {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

		test("takes unit, count and anchor, and saves them with the browser's time zone shown", async () => {
			const { wrapper, api } = await open();
			await click(wrapper, '[data-column="when"] [data-add="schedule"]');
			expect(wrapper.get(".panel [data-time-zone]").text()).toContain(zone);
			await wrapper.get('.panel select[name="unit"]').setValue("week");
			await wrapper.get('.panel input[name="count"]').setValue("2");
			await wrapper.get('.panel input[name="date"]').setValue("2026-11-01");
			await wrapper.get('.panel input[name="time"]').setValue("03:00");
			expect(sentence(wrapper)).toStartWith("when every 2 weeks from 01 nov at 03:00, take");
			await save(wrapper);
			expect((await api.applets.get("a1")).schedule).toEqual({
				kind: "interval",
				unit: "week",
				count: 2,
				anchor: "2026-11-01T03:00:00",
				timeZone: zone,
			});
		});

		test("won't save a count below 1", async () => {
			const { wrapper, api } = await open();
			await click(wrapper, '[data-column="when"] [data-add="schedule"]');
			await wrapper.get('.panel input[name="count"]').setValue("0");
			await save(wrapper);
			const field = wrapper.get('.panel input[name="count"]').element.closest(".field");
			expect(field?.querySelector(".issue")?.textContent).toBeTruthy();
			expect((await api.applets.get("a1")).schedule).toBeNull();
		});

		test("can be removed", async () => {
			const { wrapper, api } = await open({
				applets: [
					{
						...applet,
						schedule: {
							kind: "interval",
							unit: "day",
							count: 1,
							anchor: "2026-11-01T07:00:00",
							timeZone: zone,
						},
					},
				],
			});
			expect(sentence(wrapper)).toStartWith("when every day at 07:00");
			await click(wrapper, '[data-column="when"] [data-trigger="schedule"] .select');
			await click(wrapper, ".panel button", "remove schedule");
			await save(wrapper);
			expect((await api.applets.get("a1")).schedule).toBeNull();
		});
	});

	describe("the webhook", () => {
		test("shows its url with the token once, with a copy button", async () => {
			const first = await open();
			await click(first.wrapper, '[data-column="when"] [data-add="webhook"]');
			const url = first.wrapper.get(".panel [data-copy] code").text();
			expect(url).toMatch(/\/hooks\/a1\/.+/);
			expect(first.wrapper.get(".panel").text()).toContain("won't be shown again");
			expect(sentence(first.wrapper)).toStartWith("when on webhook");

			await click(first.wrapper, '[data-column="when"] [data-trigger="webhook"] .select');
			expect(first.wrapper.find(".panel [data-copy]").exists()).toBe(true);
			await first.router.push("/settings");
			await first.router.push("/applets/a1");
			await settle();
			await click(first.wrapper, '[data-column="when"] [data-trigger="webhook"] .select');
			expect(first.wrapper.find(".panel [data-copy]").exists()).toBe(false);
		});

		test("can be regenerated, showing a new token, or removed", async () => {
			const { wrapper, api } = await open({ applets: [{ ...applet, hasWebhook: true }] });
			await click(wrapper, '[data-column="when"] [data-trigger="webhook"] .select');
			await click(wrapper, ".panel button", "regenerate");
			expect(wrapper.get(".panel [data-copy] code").text()).toMatch(/\/hooks\/a1\/.+/);

			await click(wrapper, ".panel button", "remove webhook");
			expect((await api.applets.get("a1")).hasWebhook).toBe(false);
			expect(wrapper.find('[data-column="when"] [data-trigger="webhook"]').exists()).toBe(false);
		});
	});

	describe("leaving with unsaved changes", () => {
		test("asks first, and stays when told to", async () => {
			const { wrapper, router } = await open();
			await wrapper.get('input[name="applet-name"]').setValue("changed");
			const leaving = router.push("/settings");
			await settle();
			expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true);
			await click(wrapper, '[role="alertdialog"] button', "stay");
			await leaving;
			expect(router.currentRoute.value.path).toBe("/applets/a1");
			expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
		});

		test("leaves when told to", async () => {
			const { wrapper, router } = await open();
			await wrapper.get('input[name="applet-name"]').setValue("changed");
			const leaving = router.push("/settings");
			await settle();
			await click(wrapper, '[role="alertdialog"] button', "leave");
			await leaving;
			expect(router.currentRoute.value.path).toBe("/settings");
		});

		test("doesn't ask once the changes are saved", async () => {
			const { wrapper, router } = await open();
			await wrapper.get('input[name="applet-name"]').setValue("changed");
			await save(wrapper);
			await router.push("/settings");
			await settle();
			expect(router.currentRoute.value.path).toBe("/settings");
		});
	});
});
