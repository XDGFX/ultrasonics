import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import type { Plugin } from "@ultrasonics/plugin-sdk";
import { officialPlugins } from "@ultrasonics/registry";
import { importWith } from "../import-v1.ts";
import { REPORT_FILE } from "../report.ts";
import { buildV1Database, fixtureMappings, fixturePlugins, useImport } from "../test-support.ts";
import { lastfmMapping, notes, V1_PLAYLIST_TITLE } from "./lastfm.ts";

describe("lastfmMapping.instance", () => {
	const map = (v1: Record<string, string>) =>
		lastfmMapping.instance("inputs", v1, { username: "rj" });

	test.each([
		["0", {}, notes.notWholeNumber("0")],
		["5000", { limit: 1_000 }, notes.aboveMost(5000)],
		[" 30 ", { limit: 30 }, undefined],
	])("a limit of %p", (written, settings, note) => {
		const mapped = map({ select: "Loved Tracks", limit: written });
		expect(mapped.settings).toMatchObject(settings);
		if (!("limit" in settings)) expect(mapped.settings).not.toHaveProperty("limit");
		expect(mapped.notes).toEqual(note === undefined ? [] : [note]);
	});

	test("a blank or unknown choice takes the default, noting which", () => {
		const mapped = map({
			select: "Recent Tracks",
			limit: "10",
			"period-end": "",
			"period-duration": "5 Weeks",
		});
		expect(mapped.settings).not.toHaveProperty("ending");
		expect(mapped.settings).not.toHaveProperty("span");
		expect(mapped.notes).toEqual([notes.blankChoice("ending"), notes.unknownChoice("span")]);
	});

	test("no v1 username is noted", () => {
		const mapped = lastfmMapping.instance("inputs", { select: "Loved Tracks", limit: "10" }, {});
		expect(mapped.settings).toMatchObject({ username: "" });
		expect(mapped.notes).toEqual([notes.noUsername]);
	});
});

/** The `## heading` section of the report, up to the next. */
function section(markdown: string, heading: string): string {
	const start = markdown.indexOf(`\n## ${heading}\n`);
	if (start === -1) return "";
	const end = markdown.indexOf("\n## ", start + 1);
	return markdown.slice(start, end === -1 ? undefined : end);
}

describe("the Last.fm mapping", () => {
	const harness = useImport();

	const imported = async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-lastfm.sql");
		const lastfm = (await officialPlugins.lastfm.load()).default;
		const plugins = new Map<string, Plugin>([...fixturePlugins, ["lastfm", lastfm]]);
		const outcome = await importWith(h.options({ plugins }), [lastfmMapping, ...fixtureMappings]);
		const [accountId] = await v1ImportStore(h.db).accountIds();
		if (!accountId) throw new Error("no account");
		const applets = await h.db.storeFor(accountId).applets.list();
		const inputOf = (name: string) =>
			applets.find((applet) => applet.name === name)?.definition.inputs;
		const markdown = readFileSync(join(h.dataDir, REPORT_FILE), "utf8");
		return { outcome, inputOf, markdown, lastfm };
	};

	test("imports every applet, copying v1's username onto each", async () => {
		const { outcome, inputOf } = await imported();

		expect(outcome).toMatchObject({ kind: "imported", imported: 5, skipped: 0 });
		expect(await inputOf("Loved")).toEqual([
			{
				plugin: "lastfm",
				settings: { select: "loved", username: "rj", name: "My loves", limit: 100 },
			},
		]);
		expect(await inputOf("Top")).toEqual([
			{
				plugin: "lastfm",
				settings: {
					select: "top",
					username: "rj",
					name: V1_PLAYLIST_TITLE,
					limit: 25,
					period: "3month",
				},
			},
		]);
		expect(await inputOf("Recent")).toEqual([
			{
				plugin: "lastfm",
				settings: {
					select: "recent",
					username: "rj",
					name: "Last month",
					limit: 1_000,
					ending: "1m",
					span: "1d",
				},
			},
		]);
	});

	test("leaves a blank or non-numeric limit out, so the default applies, and says so", async () => {
		const { inputOf, markdown } = await imported();

		for (const name of ["Blank limit", "Typo limit"]) {
			const [input] = (await inputOf(name)) ?? [];
			expect(input?.settings).not.toHaveProperty("limit");
		}
		const imports = section(markdown, "Imported applets");
		expect(imports).toContain(notes.blankLimit);
		expect(imports).toContain(notes.notWholeNumber("fifty"));
	});

	test("every imported applet's settings parse, and the report asks for a Last.fm API key", async () => {
		const { markdown } = await imported();

		expect(section(markdown, "Settings that failed their plugin's checks")).toBe("");
		expect(section(markdown, "API keys to supply")).toContain("- Last.fm");
	});
});
