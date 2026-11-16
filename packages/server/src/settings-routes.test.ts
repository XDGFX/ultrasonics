import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	folder,
	folderChecks,
	GOOD_FOLDER,
	plex,
	source,
	THROWING_FOLDER,
} from "../test/fixture-plugins.ts";
import { CheckResult, ErrorBody, IssuesBody, PluginInfo, StoredSettings } from "./api.ts";
import { bodyOf, type TestApp, useTestApp } from "./test-support.ts";

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

describe("checking a plugin with a test() and no service", () => {
	const check = (call: TestApp["call"], plugin: string) =>
		call("POST", `/api/settings/${plugin}/check`);

	test("the catalogue marks only a plugin with a test() and no auth as checkable", async () => {
		const { call } = await testApp();
		const info = await bodyOf(await call("GET", "/api/plugins"), z.array(PluginInfo));
		expect(info.filter((plugin) => plugin.checkable).map((plugin) => plugin.name)).toEqual([
			folder.name,
		]);
	});

	test("answers ok when the plugin's test() passes with the stored settings", async () => {
		const { call } = await testApp();
		await call("PUT", `/api/settings/${folder.name}`, { path: GOOD_FOLDER });
		const response = await check(call, folder.name);
		expect(response.status).toBe(200);
		expect(await bodyOf(response, CheckResult)).toEqual({ ok: true });
	});

	test("answers the plugin's failure as plain data", async () => {
		const { call } = await testApp();
		await call("PUT", `/api/settings/${folder.name}`, { path: "/elsewhere" });
		const response = await check(call, folder.name);
		expect(response.status).toBe(200);
		expect(await bodyOf(response, CheckResult)).toEqual({
			ok: false,
			code: "misconfigured",
			message: expect.stringContaining("/elsewhere"),
		});
	});

	test("stored settings that fail the schema answer their issues, and test() is not called", async () => {
		const { call, db, mine } = await testApp();
		await db.storeFor(mine).pluginSettings.put(folder.name, { path: 7 });
		const before = folderChecks.length;
		const response = await check(call, folder.name);
		expect(response.status).toBe(422);
		expect((await bodyOf(response, IssuesBody)).issues.map((i) => i.path)).toEqual([["path"]]);
		expect(folderChecks.length).toBe(before);
	});

	test("a test() that throws is a 500 naming the plugin", async () => {
		const { call, logger } = await testApp();
		await call("PUT", `/api/settings/${folder.name}`, { path: THROWING_FOLDER });
		const response = await check(call, folder.name);
		expect(response.status).toBe(500);
		expect((await bodyOf(response, ErrorBody)).message).toContain(folder.name);
		expect(logger.lines.some((line) => line.startsWith("error:"))).toBe(true);
	});

	test("a plugin whose check is its service's, or that has no test(), is a 422", async () => {
		const { call } = await testApp();
		// Valid settings, so the 422 can only be the plugin's kind.
		await call("PUT", `/api/settings/${plex.name}`, { library: "Music" });
		await call("PUT", `/api/settings/${source.name}`, { region: "au" });
		for (const plugin of [plex.name, source.name]) {
			expect((await check(call, plugin)).status).toBe(422);
		}
	});

	test("an unknown plugin is a 404", async () => {
		const { call } = await testApp();
		expect((await check(call, "nope")).status).toBe(404);
	});
});
