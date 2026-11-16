import { describe, expect, test } from "bun:test";
import { Applet, AppletListing, IssuesBody, RunSummary } from "./api.ts";
import { bodyOf, useTestApp } from "./test-support.ts";

const testApp = useTestApp();

const definition = {
	inputs: [{ plugin: "source", settings: { playlist: "Discover Weekly" } }],
	modifiers: [{ plugin: "plex-mixer", settings: {} }],
	outputs: [{ plugin: "plex", settings: { playlistPrefix: "us-" } }],
};
const draft = { name: "Weekly to Plex", enabled: true, definition };

describe("create, read, update, delete", () => {
	test("a created applet reads back, lists idle with no runs, and has no webhook", async () => {
		const { call } = await testApp();
		const created = await call("POST", "/api/applets", draft);
		expect(created.status).toBe(201);
		const applet = await bodyOf(created, Applet);
		expect(applet).toEqual({ ...draft, id: expect.any(String), schedule: null, hasWebhook: false });

		expect(await bodyOf(await call("GET", `/api/applets/${applet.id}`), Applet)).toEqual(applet);
		expect(await bodyOf(await call("GET", "/api/applets"), AppletListing.array())).toEqual([
			{ ...applet, state: "idle", lastRun: null, nextRunAt: null },
		]);
	});

	test("an update replaces the name, the enabled flag and the chain", async () => {
		const { call } = await testApp();
		const { id } = await bodyOf(await call("POST", "/api/applets", draft), Applet);
		const changed = {
			name: "Renamed",
			enabled: false,
			definition: { ...definition, modifiers: [] },
		};
		const response = await call("PUT", `/api/applets/${id}`, changed);
		expect(await bodyOf(response, Applet)).toMatchObject(changed);
		expect(await bodyOf(await call("GET", `/api/applets/${id}`), Applet)).toMatchObject(changed);
	});

	test("the listing carries the newest run", async () => {
		const { call, db, mine } = await testApp();
		const { id } = await bodyOf(await call("POST", "/api/applets", draft), Applet);
		const runId = await db.storeFor(mine).runs.start(id, "manual");
		const [listing] = await bodyOf(await call("GET", "/api/applets"), AppletListing.array());
		expect(listing?.lastRun).toEqual({
			id: runId ?? "",
			status: "running",
			at: expect.any(Number),
		});
	});

	test("deleting an applet deletes its runs", async () => {
		const { call, db, mine } = await testApp();
		const { id } = await bodyOf(await call("POST", "/api/applets", draft), Applet);
		const runId = await db.storeFor(mine).runs.start(id, "manual");
		expect(await bodyOf(await call("GET", `/api/runs/${runId}`), RunSummary)).toMatchObject({
			appletId: id,
			trigger: "manual",
			status: "running",
			finishedAt: null,
		});

		expect((await call("DELETE", `/api/applets/${id}`)).status).toBe(204);
		expect((await call("GET", `/api/applets/${id}`)).status).toBe(404);
		expect((await call("GET", `/api/runs/${runId}`)).status).toBe(404);
	});

	test("an unknown applet is a 404 on every route", async () => {
		const { call } = await testApp();
		for (const [method, body] of [["GET"], ["PUT", draft], ["DELETE"]] as const) {
			expect((await call(method, "/api/applets/nope", body)).status).toBe(404);
		}
	});
});

describe("validation", () => {
	const issuesFor = async (body: unknown, method = "POST", path = "/api/applets") => {
		const { call } = await testApp();
		const response = await call(method, path, body);
		expect(response.status).toBe(422);
		return (await bodyOf(response, IssuesBody)).issues.map((issue) => issue.path);
	};

	test("issues sit at the paths the builder attaches them to", async () => {
		const paths = await issuesFor({
			name: " ",
			enabled: true,
			definition: {
				inputs: [
					{ plugin: "source", settings: { playlist: "" } },
					{ plugin: "nonexistent", settings: {} },
				],
				modifiers: [],
				outputs: [{ plugin: "source", settings: {} }],
			},
		});
		expect(paths).toEqual([
			["name"],
			["inputs", 0, "settings", "playlist"],
			["inputs", 1],
			["outputs", 0],
		]);
	});

	test("an applet without an input or an output is refused at that component", async () => {
		const paths = await issuesFor({
			...draft,
			definition: { ...definition, inputs: [], outputs: [] },
		});
		expect(paths).toEqual([["inputs"], ["outputs"]]);
	});

	test("a body of the wrong shape is refused with issues", async () => {
		expect(await issuesFor({ name: "No chain", enabled: true })).toEqual([["definition"]]);
	});

	test("an update is validated like a create", async () => {
		const { call } = await testApp();
		const { id } = await bodyOf(await call("POST", "/api/applets", draft), Applet);
		const response = await call("PUT", `/api/applets/${id}`, { ...draft, name: "" });
		expect((await bodyOf(response, IssuesBody)).issues.map((i) => i.path)).toEqual([["name"]]);
		expect(await bodyOf(await call("GET", `/api/applets/${id}`), Applet)).toMatchObject({
			name: draft.name,
		});
	});

	test("a stored slot that no longer parses comes back raw, and saving it shows its issues", async () => {
		const { call, db, mine } = await testApp();
		const stale = {
			...definition,
			inputs: [{ plugin: "source", settings: { playlist: 42, removedField: true } }],
		};
		const { id } = await db
			.storeFor(mine)
			.applets.create({ name: "after an update", definition: stale });

		const applet = await bodyOf(await call("GET", `/api/applets/${id}`), Applet);
		expect(applet.definition).toEqual(stale);

		const response = await call("PUT", `/api/applets/${id}`, {
			name: applet.name,
			enabled: applet.enabled,
			definition: applet.definition,
		});
		expect((await bodyOf(response, IssuesBody)).issues.map((i) => i.path)).toEqual([
			["inputs", 0, "settings", "playlist"],
		]);
	});
});
