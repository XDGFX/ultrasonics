import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppletListing, ErrorBody, ServiceStatus, StoredSettings } from "./api.ts";
import { JSON_REQUIRED_MESSAGE } from "./cross-site.ts";
import { bodyOf, useTestApp } from "./test-support.ts";

const testApp = useTestApp();

const definition = {
	inputs: [{ plugin: "source", settings: { playlist: "Discover Weekly" } }],
	modifiers: [],
	outputs: [{ plugin: "plex", settings: {} }],
};
const draft = { name: "Weekly to Plex", enabled: true, definition };

describe("cross-site requests (ADR-0030)", () => {
	test.each([
		["text/plain", { "Content-Type": "text/plain" }],
		["a form", { "Content-Type": "application/x-www-form-urlencoded" }],
		["multipart", { "Content-Type": "multipart/form-data; boundary=x" }],
	])("a mutating request sent as %s is 415", async (_, headers) => {
		const { app, call } = await testApp();
		const response = await app.request("/api/applets", {
			method: "POST",
			headers,
			body: JSON.stringify(draft),
		});
		expect(response.status).toBe(415);
		expect(await bodyOf(response, ErrorBody)).toEqual({ message: JSON_REQUIRED_MESSAGE });
		expect(await (await call("GET", "/api/applets")).json()).toEqual([]);
	});

	test("a mutating request with no content type is 415, even with no body", async () => {
		const { app } = await testApp();
		const response = await app.request("/api/services/plex/begin", { method: "POST" });
		expect(response.status).toBe(415);
	});

	test("JSON with a charset is accepted", async () => {
		const { call } = await testApp();
		const response = await call("POST", "/api/applets", draft, {
			"Content-Type": "application/json; charset=utf-8",
		});
		expect(response.status).toBe(201);
	});

	test("no response carries a CORS header, so a cross-origin preflight never succeeds", async () => {
		const { app, call } = await testApp();
		const origin = { Origin: "https://evil.example" };
		const responses = [
			await app.request("/api/applets", {
				method: "OPTIONS",
				headers: {
					...origin,
					"Access-Control-Request-Method": "POST",
					"Access-Control-Request-Headers": "content-type",
				},
			}),
			await call("GET", "/api/applets", undefined, origin),
			await call("POST", "/api/applets", draft, origin),
		];
		for (const response of responses) {
			expect(
				[...response.headers.keys()].filter((key) => key.startsWith("access-control")),
			).toEqual([]);
		}
	});
});

describe("scoping (ADR-0003 at the API)", () => {
	test("no route reads or changes another account's rows", async () => {
		const { call, db, theirs } = await testApp();
		const store = db.storeFor(theirs);
		const applet = await store.applets.create({ name: "theirs", definition });
		const runId = await store.runs.start(applet.id, "manual");
		await store.pluginSettings.put("source", { region: "gb" });
		await store.credentials.put("plex", { url: "http://plex", token: "theirs" }, null);

		for (const [method, path, body] of [
			["GET", `/api/applets/${applet.id}`],
			["PUT", `/api/applets/${applet.id}`, draft],
			["DELETE", `/api/applets/${applet.id}`],
			["GET", `/api/runs/${runId}`],
			["GET", `/api/runs/${runId}/events`],
			["POST", `/api/applets/${applet.id}/run`],
		] as const) {
			const response = await call(method, path, body);
			expect({ method, path, status: response.status }).toEqual({ method, path, status: 404 });
			expect(await bodyOf(response, ErrorBody)).toEqual({ message: expect.any(String) });
		}
		expect(await bodyOf(await call("GET", "/api/applets"), AppletListing.array())).toEqual([]);
		expect(await bodyOf(await call("GET", "/api/settings/source"), StoredSettings)).toEqual({
			value: {},
			issues: [expect.objectContaining({ path: ["region"] })],
		});
		const services = await bodyOf(await call("GET", "/api/services"), ServiceStatus.array());
		expect(services.find((s) => s.service === "plex")?.status).toEqual({ kind: "not-connected" });

		expect(await store.applets.get(applet.id)).toMatchObject({ name: "theirs" });
		expect(await store.runs.get(runId ?? "")).toMatchObject({ status: "running" });
	});
});

describe("errors", () => {
	test("an unknown API route is a 404 with a message", async () => {
		const { call } = await testApp();
		const response = await call("GET", "/api/nothing-here");
		expect(response.status).toBe(404);
		expect(await bodyOf(response, ErrorBody)).toEqual({ message: expect.any(String) });
	});

	test("a malformed JSON body is a 400 with a message", async () => {
		const { app } = await testApp();
		const response = await app.request("/api/applets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{not json",
		});
		expect(response.status).toBe(400);
		expect(await bodyOf(response, ErrorBody)).toEqual({ message: expect.any(String) });
	});
});

describe("the built UI", () => {
	const withUi = async () => {
		const setup = await testApp();
		const webRoot = join(setup.dataDir, "web");
		mkdirSync(join(webRoot, "assets"), { recursive: true });
		writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>ultrasonics</title>");
		writeFileSync(join(webRoot, "assets", "app.js"), "console.log('ui')");
		return testApp({ webRoot });
	};

	test("is served from /, with its assets", async () => {
		const { call } = await withUi();
		expect(await (await call("GET", "/")).text()).toContain("<title>ultrasonics</title>");
		expect(await (await call("GET", "/assets/app.js")).text()).toBe("console.log('ui')");
	});

	test("falls back to index.html for any non-API path, such as the OAuth return", async () => {
		const { call } = await withUi();
		const response = await call("GET", "/services/spotify?code=abc");
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("<title>ultrasonics</title>");
	});

	test("never answers an API path with the SPA", async () => {
		const { call } = await withUi();
		const response = await call("GET", "/api/nothing-here");
		expect(response.status).toBe(404);
		expect(response.headers.get("Content-Type")).toContain("application/json");
	});
});
