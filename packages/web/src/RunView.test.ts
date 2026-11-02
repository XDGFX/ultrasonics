import { afterEach, describe, expect, test } from "bun:test";
import { mountApp, settle } from "../test/mount-app.ts";
import type { RunSummary } from "./api-client.ts";
import type { FakeApplet } from "./fake-api.ts";
import { authFailedRun, partialRun, succeededRun } from "./fake-runs.ts";
import { queuedMessage } from "./run-now.ts";
import type { RunPace } from "./scripted-run.ts";

const applet: FakeApplet = {
	id: "a",
	name: "weekly",
	enabled: true,
	definition: {
		inputs: [{ plugin: "spotify", settings: { source: "saved" } }],
		modifiers: [],
		outputs: [{ plugin: "plex", settings: {} }],
	},
	schedule: null,
	hasWebhook: false,
};

const summary = (id: string): RunSummary => ({
	id,
	appletId: "a",
	trigger: "schedule",
	status: "running",
	startedAt: Date.UTC(2026, 10, 2, 7, 0, 2),
	finishedAt: null,
});

const openRun = (events: unknown[], pace?: RunPace) =>
	mountApp("/runs/r", {
		applets: [applet],
		runs: [{ ...summary("r"), events, ...(pace ? { pace } : {}) }],
	});

type Wrapper = Awaited<ReturnType<typeof mountApp>>["wrapper"];
const texts = (wrapper: Wrapper, selector: string) =>
	wrapper.findAll(selector).map((found) => found.text());

afterEach(() => {
	document.body.innerHTML = "";
});

describe("the run view", () => {
	test("heads the run with its id, songs written, status, trigger, start and duration", async () => {
		const { wrapper } = await openRun(succeededRun);
		expect(wrapper.get("h2").text()).toBe("run r · 54 songs written to plex");
		expect(wrapper.get("[data-status]").attributes("data-status")).toBe("succeeded");
		expect(wrapper.get("[data-trigger]").text()).toContain("schedule");
		expect(wrapper.get("[data-started]").text()).toContain("07:00");
		expect(wrapper.get("[data-took]").text()).toContain("41 s");
	});

	test("shows the stages in order, with the songs and playlists out of each between them", async () => {
		const { wrapper } = await openRun(succeededRun);
		expect(texts(wrapper, ".stage .plugin")).toEqual(["spotify", "deduplicate", "plex"]);
		expect(texts(wrapper, ".stage .mark")).toEqual(["✓", "✓", "✓"]);
		expect(texts(wrapper, ".wire")).toEqual(["60 songs · 2 playlists", "57 songs · 2 playlists"]);
	});

	test("tables each output's playlists with their unmatched songs, skips and failures", async () => {
		const { wrapper } = await openRun(succeededRun);
		const rows = wrapper.findAll("[data-output] tbody tr");
		expect(rows.map((row) => [row.get(".playlist").text(), row.get(".matched").text()])).toEqual([
			["discover weekly", "28 of 30"],
			["release radar", "26 of 27"],
		]);
		expect(rows[0]?.get("[data-result]").text()).toBe("written");
		expect(rows[0]?.get(".unmatched").text()).toBe(
			"lake effect — hania rani · doppelgänger — kiasmos",
		);
		expect(rows[1]?.get(".unmatched").text()).toBe("hand over — peggy gou, someone");

		const partial = (await openRun(partialRun)).wrapper;
		const reasons = partial
			.findAll("[data-output] tbody tr")
			.map((row) => [row.get("[data-result]").text(), row.get(".reason").text()]);
		expect(reasons).toEqual([
			["written", ""],
			["skipped", "empty: no songs"],
			["failed", "timeout: plex timed out"],
		]);
	});

	test("lists rejections with their source and issue, and how many are not shown", async () => {
		const { wrapper } = await openRun(partialRun);
		expect(wrapper.get(".stage [data-rejected]").text()).toBe("3 rejected");
		const listed = texts(wrapper, ".rejections li");
		expect(listed[0]).toContain("spotify");
		expect(listed[0]).toContain("discover weekly");
		expect(listed[0]).toContain("Too small");
		expect(listed).toHaveLength(2);
		expect(wrapper.get("[data-not-shown]").text()).toBe("spotify (inputs): 1 not shown");

		const clean = (await openRun(succeededRun)).wrapper;
		expect(clean.get(".rejections").text()).toBe("rejected: none");
	});

	test("shows a failed stage's error, and reconnect for a service-auth failure", async () => {
		const { wrapper, router } = await openRun(authFailedRun);
		expect(texts(wrapper, ".stage .mark")).toEqual(["✗"]);
		expect(wrapper.get(".stage .error").text()).toContain("reconnect: spotify refused");
		const reconnect = wrapper.get("a.reconnect");
		expect(reconnect.text()).toBe("reconnect spotify");
		await reconnect.trigger("click");
		await settle();
		expect(router.currentRoute.value.fullPath).toBe("/services/spotify");
	});

	test("pins the log with each line's time, level and source", async () => {
		const { wrapper } = await openRun(succeededRun);
		const lines = wrapper.findAll(".console [data-level]");
		expect(lines.map((line) => line.attributes("data-level"))).toEqual(["info", "info", "warn"]);
		expect(lines[2]?.text()).toMatch(/^\d\d:\d\d:22 warn plex no match for lake effect$/);
	});

	test("ends in the same view whether replayed at once or watched live", async () => {
		const replayed = (await openRun(succeededRun)).wrapper.get(".run").html();
		document.body.innerHTML = "";

		const { wrapper, api } = await openRun(succeededRun, "stepped");
		expect(wrapper.get("[data-status]").attributes("data-status")).toBe("running");
		for (const _ of succeededRun) {
			api.scripts.advance("r");
			await settle();
		}
		expect(wrapper.get(".run").html()).toBe(replayed);
	});

	test("resumes after a dropped connection without repeating events, and stops at the end", async () => {
		const { wrapper, api } = await openRun(succeededRun, "stepped");
		api.scripts.advance("r", 3);
		await settle();
		api.scripts.drop("r");
		await settle();
		api.scripts.advance("r", succeededRun.length);
		await settle();
		expect(wrapper.findAll(".console [data-level]")).toHaveLength(3);
		const connections = api.scripts.connections("r");

		api.scripts.drop("r");
		await settle();
		expect(api.scripts.connections("r")).toBe(connections);
	});

	test("closes the stream of a live run when the view is left", async () => {
		const { api, router } = await openRun(succeededRun, "stepped");
		api.scripts.advance("r");
		await settle();
		expect(api.scripts.open("r")).toBe(1);
		await router.push("/settings");
		await settle();
		expect(api.scripts.open("r")).toBe(0);
	});
});

describe("run now", () => {
	const ran = { ...applet, lastRun: { id: "r", status: "succeeded" as const, at: 0 } };

	test("▶ on a row opens the run it started", async () => {
		const { wrapper, router } = await mountApp("/", { applets: [applet] });
		await wrapper.get('button[title="run now"]').trigger("click");
		await settle();
		expect(router.currentRoute.value.name).toBe("run");
		expect(wrapper.get("h2").text()).toStartWith(`run ${router.currentRoute.value.params.id}`);
	});

	test("says queued and stays put when the applet is already running", async () => {
		const { wrapper, router } = await mountApp("/", {
			applets: [{ ...applet, state: "running" }],
		});
		await wrapper.get('button[title="run now"]').trigger("click");
		await settle();
		expect(router.currentRoute.value.name).toBe("applets");
		expect(wrapper.get("[data-queued]").text()).toBe(queuedMessage);
		expect(wrapper.get(".pill").text()).toBe("queued");
	});

	test("▶ run now in the builder opens the run it started", async () => {
		const { wrapper, router } = await mountApp("/applets/a", { applets: [applet] });
		await wrapper.get("button.run-now").trigger("click");
		await settle();
		expect(router.currentRoute.value.name).toBe("run");
	});

	test("the builder offers run now once the applet is saved, and not over unsaved edits", async () => {
		const { wrapper } = await mountApp("/applets/a", { applets: [applet] });
		await wrapper.get('input[name="applet-name"]').setValue("renamed");
		expect(wrapper.get("button.run-now").attributes("disabled")).toBeDefined();

		const fresh = (await mountApp("/applets/new", { applets: [applet] })).wrapper;
		expect(fresh.find("button.run-now").exists()).toBe(false);
	});

	test("run now in the builder says queued and stays put", async () => {
		const { wrapper, router } = await mountApp("/applets/a", {
			applets: [{ ...applet, state: "running" }],
		});
		await wrapper.get("button.run-now").trigger("click");
		await settle();
		expect(router.currentRoute.value.fullPath).toBe("/applets/a");
		expect(wrapper.get("[data-queued]").text()).toBe(queuedMessage);
	});

	test("run again on the run view opens the next run, or says queued", async () => {
		const { wrapper, router } = await mountApp("/runs/r", {
			applets: [ran],
			runs: [{ ...summary("r"), events: succeededRun }],
		});
		await wrapper.get("button.run-now").trigger("click");
		await settle();
		expect(router.currentRoute.value.params.id).not.toBe("r");
		expect(wrapper.get("h2").text()).toStartWith(`run ${router.currentRoute.value.params.id}`);

		await wrapper.get("button.run-now").trigger("click");
		await settle();
		expect(wrapper.get("[data-queued]").text()).toBe(queuedMessage);
	});
});
