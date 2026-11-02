import { describe, expect, test } from "bun:test";
import { RunEvent } from "@ultrasonics/core/run-events";
import { toFormSchema } from "@ultrasonics/plugin-sdk";
import type { AppletDraft } from "./api-client.ts";
import { createFakeApi } from "./fake-api.ts";
import { catalogue, deduplicate, plex, spotify } from "./fake-catalogue.ts";
import { authFailedRun, partialRun, succeededRun } from "./fake-runs.ts";

const draft: AppletDraft = {
	name: "weekly",
	enabled: true,
	definition: {
		inputs: [{ plugin: "spotify", settings: { source: "saved" } }],
		modifiers: [],
		outputs: [{ plugin: "plex", settings: {} }],
	},
};

describe("the fake ApiClient", () => {
	test("serves each plugin's forms as toFormSchema produces them", async () => {
		const api = createFakeApi({ plugins: catalogue });
		const [served] = (await api.plugins()).filter((plugin) => plugin.name === "plex");
		if (!plex.persistentSettings) throw new Error("the plex fixture has no persistent settings");
		const expected = toFormSchema(plex.persistentSettings);
		if (!expected.ok) throw new Error("the plex fixture does not convert");
		expect(served?.persistentSettings).toEqual(expected.jsonSchema);
		expect(served?.service).toBe("plex");
		expect(served?.components).toEqual(["outputs"]);
	});

	test("answers a settings save with the Zod schema's issues, and stores a valid one", async () => {
		const api = createFakeApi({ plugins: catalogue });
		const rejected = await api.settings.save("plex", { library: 7 });
		expect(rejected.ok).toBe(false);
		expect(!rejected.ok && rejected.issues.map((issue) => issue.path)).toEqual([["library"]]);

		expect((await api.settings.save("plex", { library: "audio" })).ok).toBe(true);
		expect(await api.settings.get("plex")).toEqual({ value: { library: "audio" }, issues: [] });
	});

	test("reports the issues of a stored value that no longer parses", async () => {
		const api = createFakeApi({ plugins: catalogue, settings: { plex: { library: 7 } } });
		const stored = await api.settings.get("plex");
		expect(stored.issues.map((issue) => issue.path)).toEqual([["library"]]);
	});

	test("validates an applet's instance settings with the plugin's schema, by slot", async () => {
		const api = createFakeApi({ plugins: catalogue });
		const bad = {
			...draft,
			definition: {
				...draft.definition,
				inputs: [{ plugin: "spotify", settings: { source: "chosen" } }],
			},
		};
		const result = await api.applets.create(bad);
		expect(!result.ok && result.issues.map((issue) => issue.path)).toEqual([
			["inputs", 0, "settings", "names"],
		]);
	});

	test("lists a created applet as idle and never run, and forgets a deleted one", async () => {
		const api = createFakeApi({ plugins: catalogue });
		const created = await api.applets.create(draft);
		if (!created.ok) throw new Error("expected the draft to save");
		expect(await api.applets.list()).toMatchObject([
			{ id: created.value.id, name: "weekly", state: "idle", lastRun: null },
		]);
		await api.applets.delete(created.value.id);
		expect(await api.applets.list()).toEqual([]);
	});

	test("answers run now with queued while the applet is already running", async () => {
		const api = createFakeApi({ plugins: catalogue });
		const created = await api.applets.create(draft);
		if (!created.ok) throw new Error("expected the draft to save");
		expect((await api.applets.runNow(created.value.id)).kind).toBe("started");
		expect((await api.applets.runNow(created.value.id)).kind).toBe("queued");
	});

	test("lists each service the plugins use, with its status and the plugins using it", async () => {
		const api = createFakeApi({
			plugins: [spotify, plex, deduplicate],
			grants: { plex: { kind: "connected" } },
		});
		expect(await api.services.list()).toEqual([
			{
				service: "spotify",
				flow: "oauth2-pkce",
				status: { kind: "not-connected" },
				usedBy: ["spotify"],
			},
			{ service: "plex", flow: "token", status: { kind: "connected" }, usedBy: ["plex"] },
		]);
	});

	test("configures a token service: field issues, then a test failure, then connected", async () => {
		const api = createFakeApi({ plugins: catalogue, testFailures: { plex: "connection refused" } });
		const invalid = await api.services.configure("plex", { address: "http://plex" });
		expect(invalid.kind === "invalid" && invalid.issues.map((issue) => issue.path)).toEqual([
			["token"],
		]);
		const input = { address: "http://plex", token: "t" };
		expect(await api.services.configure("plex", input)).toEqual({
			kind: "test-failed",
			message: "connection refused",
		});

		const working = createFakeApi({ plugins: catalogue });
		expect(await working.services.configure("plex", input)).toEqual({ kind: "saved" });
		const [, plexStatus] = await working.services.list();
		expect(plexStatus?.status).toEqual({ kind: "connected" });
	});

	test("completes an oauth flow through a URL inside the app", async () => {
		const api = createFakeApi({ plugins: catalogue });
		const { authoriseUrl } = await api.services.begin("spotify");
		const url = new URL(authoriseUrl, "http://app.test");
		expect(url.pathname).toBe("/services/spotify");
		const outcome = await api.services.outcome("spotify", Object.fromEntries(url.searchParams));
		expect(outcome).toEqual({ kind: "connected" });
		const [spotifyStatus] = await api.services.list();
		expect(spotifyStatus?.status).toEqual({ kind: "connected" });
	});
});

const summary = {
	appletId: "a",
	trigger: "manual",
	status: "running",
	startedAt: Date.UTC(2026, 10, 2, 7),
	finishedAt: null,
} as const;

async function collect(events: AsyncIterable<RunEvent>): Promise<number[]> {
	const seen: number[] = [];
	for await (const event of events) seen.push(event.seq);
	return seen;
}

describe("the fake's scripted runs", () => {
	test("parses every scripted run with the run-event schema", () => {
		for (const script of [succeededRun, authFailedRun, partialRun]) {
			expect(() => script.map((event) => RunEvent.parse(event))).not.toThrow();
		}
		const broken = [{ seq: 1, at: 0, type: "end", status: "fine" }];
		expect(() =>
			createFakeApi({ plugins: catalogue, runs: [{ ...summary, id: "r", events: broken }] }),
		).toThrow();
	});

	test("replays a run at once, ending after `end`", async () => {
		const api = createFakeApi({
			plugins: catalogue,
			runs: [{ ...summary, id: "r", events: succeededRun }],
		});
		expect(await collect(api.runs.events("r"))).toEqual(succeededRun.map((_, index) => index + 1));
	});

	test("releases a stepped run's events as the test advances it", async () => {
		const api = createFakeApi({
			plugins: catalogue,
			runs: [{ ...summary, id: "r", events: authFailedRun, pace: "stepped" }],
		});
		const seen = collect(api.runs.events("r"));
		api.scripts.advance("r", 2);
		api.scripts.advance("r", 2);
		expect(await seen).toEqual([1, 2, 3, 4]);
		expect((await api.runs.get("r")).status).toBe("failed");
	});

	test("resumes after a dropped connection from the last seq, repeating nothing", async () => {
		const api = createFakeApi({
			plugins: catalogue,
			runs: [{ ...summary, id: "r", events: succeededRun, pace: "stepped" }],
		});
		const seen = collect(api.runs.events("r"));
		api.scripts.advance("r", 3);
		await Bun.sleep(0);
		api.scripts.drop("r");
		api.scripts.advance("r", succeededRun.length);
		expect(await seen).toEqual(succeededRun.map((_, index) => index + 1));
		expect(api.scripts.connections("r")).toBe(2);
	});

	test("plays an applet's script when it is run now, and queues a second run", async () => {
		const api = createFakeApi({
			plugins: catalogue,
			applets: [{ id: "a", ...draft, schedule: null, hasWebhook: false }],
			runScripts: { a: { events: succeededRun, pace: "stepped" } },
		});
		const started = await api.applets.runNow("a");
		if (started.kind !== "started") throw new Error("the run did not start");
		expect(await api.applets.runNow("a")).toEqual({ kind: "queued" });

		api.scripts.advance(started.runId, succeededRun.length);
		await collect(api.runs.events(started.runId));
		const [listing] = await api.applets.list();
		expect(listing?.state).toBe("running");
		expect(listing?.lastRun?.id).not.toBe(started.runId);
	});
});
