import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";
import { mountApp, settle } from "../test/mount-app.ts";
import type { AppletListing } from "./api-client.ts";
import type { FakeApplet } from "./fake-api.ts";
import { LIVE_REFRESH_MS } from "./live-refresh.ts";
import { sentence, sentenceText } from "./sentence.ts";

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
		expect(wrapper.get(".count").attributes()).toMatchObject({
			"data-count": "7",
			"data-running": "1",
		});
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
		const { wrapper, api } = await mountApp("/", { applets });
		const failed = applets.find((applet) => applet.id === "f");
		if (!failed) throw new Error("no failed applet");
		expect(row(wrapper, "failed").get(".sum").text()).toBe(
			sentenceText(sentence(failed, await api.plugins())),
		);
	});

	test("shows last and next run, or the running pill and bar in their place", async () => {
		const { wrapper } = await mountApp("/", { applets });
		const running = row(wrapper, "running");
		expect(running.get(".pill").text()).toBe("running");
		expect(running.find('[role="progressbar"]').exists()).toBe(true);
		expect(running.find("[data-last]").exists()).toBe(false);

		const times = (name: string) =>
			["data-last", "data-next"].map((key) => row(wrapper, name).get(`[${key}]`).attributes(key));
		expect(times("never")).toEqual(["never", "manual"]);
		expect(times("interrupted")).toEqual(["ran", "webhook"]);
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
		expect(dialog.get("#confirm-delete").text()).toContain("failed");

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

describe("live status", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	const tick = async (times = 1) => {
		for (let i = 0; i < times; i++) {
			jest.advanceTimersByTime(LIVE_REFRESH_MS);
			await settle();
		}
	};

	test.each(["running", "queued"] as const)(
		"re-fetches the list every interval while a row is %s, and stops once none is",
		async (state) => {
			jest.useFakeTimers();
			const live = { ...base, id: "l", name: "live", state, ...ran("running", "l") };
			const idle = { ...base, id: "s", name: "succeeded", ...ran("succeeded", "s") };
			const { wrapper, api } = await mountApp("/", { applets: [live, idle] });
			const list = spyOn(api.applets, "list");

			await tick();
			expect(list).toHaveBeenCalledTimes(1);

			list.mockResolvedValue([{ ...live, state: "idle", ...ran("succeeded", "l") }, idle]);
			await tick();
			expect(row(wrapper, "live").get(".st").attributes("data-status")).toBe("succeeded");
			await tick(3);
			expect(list).toHaveBeenCalledTimes(2);
		},
	);

	test("leaves a list with nothing running alone", async () => {
		jest.useFakeTimers();
		const { api } = await mountApp("/", { applets: applets.filter((a) => a.state === "idle") });
		const list = spyOn(api.applets, "list");
		await tick(3);
		expect(list).not.toHaveBeenCalled();
	});

	test("stops re-fetching once the list is left", async () => {
		jest.useFakeTimers();
		const { wrapper, api, router } = await mountApp("/", { applets });
		const list = spyOn(api.applets, "list");
		await row(wrapper, "failed").get('a[title="edit"]').trigger("click");
		await settle();
		expect(router.currentRoute.value.name).not.toBe("applets");
		list.mockClear();
		await tick(3);
		expect(list).not.toHaveBeenCalled();
	});
});
