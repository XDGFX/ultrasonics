import { describe, expect, test } from "bun:test";
import { toFormSchema } from "@ultrasonics/plugin-sdk";
import type { AppletDraft } from "./api-client.ts";
import { createFakeApi } from "./fake-api.ts";
import { catalogue, deduplicate, plex, spotify } from "./fake-catalogue.ts";

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
