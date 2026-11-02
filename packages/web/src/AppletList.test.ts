import { afterEach, describe, expect, test } from "bun:test";
import { mountApp, settle } from "../test/mount-app.ts";
import type { AppletListing } from "./api-client.ts";
import type { FakeApplet } from "./fake-api.ts";

const base = {
	enabled: true,
	definition: {
		inputs: [{ plugin: "spotify", settings: { source: "saved" } }],
		modifiers: [{ plugin: "deduplicate", settings: {} }],
		outputs: [{ plugin: "plex", settings: {} }],
	},
	schedule: null,
	hasWebhook: false,
	state: "idle",
	lastRun: null,
	nextRunAt: null,
} satisfies Omit<FakeApplet, "id" | "name">;

const at = Date.UTC(2026, 10, 1, 7);
const ran = (status: NonNullable<AppletListing["lastRun"]>["status"], id: string) => ({
	lastRun: { id: `run-${id}`, status, at },
});

const applets: FakeApplet[] = [
	{ ...base, id: "s", name: "succeeded", ...ran("succeeded", "s") },
	{ ...base, id: "p", name: "partial", ...ran("partial", "p") },
	{ ...base, id: "f", name: "failed", ...ran("failed", "f") },
	{ ...base, id: "i", name: "interrupted", hasWebhook: true, ...ran("interrupted", "i") },
	{ ...base, id: "n", name: "never", enabled: false },
	{ ...base, id: "r", name: "running", state: "running", ...ran("running", "r") },
	{ ...base, id: "q", name: "queued", state: "queued", ...ran("succeeded", "q") },
];

const row = (wrapper: Awaited<ReturnType<typeof mountApp>>["wrapper"], name: string) => {
	const found = wrapper
		.findAll("[data-applet]")
		.find((candidate) => candidate.get(".tag").text() === name);
	if (!found) throw new Error(`no row for ${name}`);
	return found;
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("the applet list", () => {
	test("shows each row's status from its last run or its live state, each with its own glyph", async () => {
		const { wrapper } = await mountApp("/", { applets });
		const glyphs = wrapper.findAll("[data-applet] .st");
		expect(glyphs.map((glyph) => glyph.attributes("data-status"))).toEqual([
			"succeeded",
			"partial",
			"failed",
			"interrupted",
			"never-run",
			"running",
			"queued",
		]);
		expect(new Set(glyphs.map((glyph) => glyph.text())).size).toBe(applets.length);
	});

	test("counts the applets and how many are running", async () => {
		const { wrapper } = await mountApp("/", { applets });
		expect(wrapper.get(".count").text()).toBe("7 · 1 running");
	});

	test("links a row's status glyph to its last run", async () => {
		const { wrapper } = await mountApp("/", { applets });
		expect(row(wrapper, "failed").get("a.st").attributes("href")).toBe("/runs/run-f");
		expect(row(wrapper, "never").find("a.st").exists()).toBe(false);
	});

	test("greys a disabled applet's tag", async () => {
		const { wrapper } = await mountApp("/", { applets });
		expect(row(wrapper, "never").get(".tag").attributes("data-enabled")).toBe("false");
		expect(row(wrapper, "failed").get(".tag").attributes("data-enabled")).toBe("true");
	});

	test("summarises each applet as its sentence", async () => {
		const { wrapper } = await mountApp("/", { applets });
		expect(row(wrapper, "failed").get(".sum").text()).toBe(
			"manual only: take spotify, deduplicate it, and put it in plex",
		);
	});

	test("shows last and next run, or the running pill and bar in their place", async () => {
		const { wrapper } = await mountApp("/", { applets });
		const running = row(wrapper, "running");
		expect(running.get(".pill").text()).toBe("running");
		expect(running.find('[role="progressbar"]').exists()).toBe(true);
		expect(running.text()).not.toContain("last");

		const never = row(wrapper, "never").get(".times").text();
		expect(never).toContain("last never");
		expect(never).toContain("next manual");
		expect(row(wrapper, "interrupted").get(".times").text()).toContain("next on webhook");
		expect(row(wrapper, "failed").find('[role="progressbar"]').exists()).toBe(false);
	});

	test("opens the builder from ✎", async () => {
		const { wrapper, router } = await mountApp("/", { applets });
		await row(wrapper, "failed").get('a[title="edit"]').trigger("click");
		await settle();
		expect(router.currentRoute.value.fullPath).toBe("/applets/f");
	});

	test("deletes from × only after a confirmation naming the applet", async () => {
		const { wrapper, api } = await mountApp("/", { applets });
		await row(wrapper, "failed").get('button[title="delete"]').trigger("click");
		const dialog = wrapper.get('[role="alertdialog"]');
		expect(dialog.text()).toContain("delete failed and its runs?");

		await dialog.get("button.cancel").trigger("click");
		await settle();
		expect((await api.applets.list()).map((applet) => applet.id)).toContain("f");

		await row(wrapper, "failed").get('button[title="delete"]').trigger("click");
		await wrapper.get('[role="alertdialog"] button.confirm').trigger("click");
		await settle();
		expect((await api.applets.list()).map((applet) => applet.id)).not.toContain("f");
		expect(wrapper.findAll("[data-applet]")).toHaveLength(applets.length - 1);
	});

	test("gives way to first run when its last applet is deleted", async () => {
		const [only] = applets;
		const { wrapper, router } = await mountApp("/", { applets: only ? [only] : [] });
		await wrapper.get('button[title="delete"]').trigger("click");
		await wrapper.get('[role="alertdialog"] button.confirm').trigger("click");
		await settle();
		expect(router.currentRoute.value.name).toBe("first-run");
	});
});
