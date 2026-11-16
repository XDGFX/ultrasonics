import { expect, test } from "bun:test";
import { IssuesBody, StoredSettings } from "./api.ts";
import { bodyOf, useTestApp } from "./test-support.ts";

const testApp = useTestApp();

test("a valid value is stored raw and reads back with no issues", async () => {
	const { call } = await testApp();
	const response = await call("PUT", "/api/settings/source", { region: "au" });
	expect(response.status).toBe(200);
	expect(await bodyOf(await call("GET", "/api/settings/source"), StoredSettings)).toEqual({
		value: { region: "au" },
		issues: [],
	});
});

test("an invalid value is refused with issues by path, and nothing is stored", async () => {
	const { call } = await testApp();
	const response = await call("PUT", "/api/settings/source", { region: "mars" });
	expect(response.status).toBe(422);
	expect((await bodyOf(response, IssuesBody)).issues.map((i) => i.path)).toEqual([["region"]]);
	expect((await bodyOf(await call("GET", "/api/settings/source"), StoredSettings)).value).toEqual(
		{},
	);
});

test("a stored value that no longer parses reads back raw, with what it fails today", async () => {
	const { call, db, mine } = await testApp();
	await db.storeFor(mine).pluginSettings.put("source", { region: "us", legacy: 1 });
	expect(await bodyOf(await call("GET", "/api/settings/source"), StoredSettings)).toEqual({
		value: { region: "us", legacy: 1 },
		issues: [{ path: ["region"], message: expect.any(String) }],
	});
});

test("a plugin with no persistent settings refuses a save", async () => {
	const { call } = await testApp();
	const response = await call("PUT", "/api/settings/plex-mixer", {});
	expect((await bodyOf(response, IssuesBody)).issues.map((i) => i.path)).toEqual([[]]);
});

test("an unknown plugin is a 404", async () => {
	const { call } = await testApp();
	expect((await call("GET", "/api/settings/nope")).status).toBe(404);
	expect((await call("PUT", "/api/settings/nope", {})).status).toBe(404);
});
