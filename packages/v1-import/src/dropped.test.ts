import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import { DROPPED_PLUGINS } from "./dropped.ts";
import { importWith } from "./import-v1.ts";
import type { Mapping } from "./mapping.ts";
import { REPORT_FILE } from "./report.ts";
import { buildV1Database, fixtureMappings, useImport } from "./test-support.ts";

/** One skipped applet's entry in the report, from its `###` heading to the next heading. */
function skipOf(markdown: string, applet: string): string {
	const start = markdown.indexOf(`\n### ${applet}\n`);
	if (start === -1) return "";
	const end = markdown.slice(start + 1).search(/\n#{2,3} /);
	return markdown.slice(start, end === -1 ? undefined : start + 1 + end);
}

describe("plugins v2 dropped", () => {
	const harness = useImport();

	const imported = async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-dropped.sql");
		const outcome = await h.run();
		const markdown = readFileSync(join(h.dataDir, REPORT_FILE), "utf8");
		return { h, outcome, markdown };
	};

	test("imports none of the fixture's applets", async () => {
		const { outcome } = await imported();

		expect(outcome).toMatchObject({ kind: "imported", imported: 0, skipped: 7 });
	});

	test.each([
		["Mixed", "spotify mixer", '"count": "30"'],
		["From Deezer", "deezer", '"filter": "chill"'],
		["To Deezer", "deezer", '"existing_playlists": "Update"'],
		["Run a script", "system command", '"command": "touch /tmp/synced"'],
		["Never gonna", "rickroll", '"plugin": "rickroll"'],
		["Bones", "skeleton", '"plugin": "skeleton"'],
	])("reports %s with %s's reason and its v1 config", async (applet, plugin, config) => {
		const { markdown } = await imported();
		const entry = skipOf(markdown, applet);

		expect(entry).toContain(DROPPED_PLUGINS.get(plugin) ?? "a reason");
		expect(entry).toContain(config);
	});

	test("still reports a plugin it neither maps nor dropped as unknown", async () => {
		const { markdown } = await imported();
		const entry = skipOf(markdown, "My own plugin");

		expect(entry).toContain("homebrew 0.2");
		for (const reason of DROPPED_PLUGINS.values()) expect(entry).not.toContain(reason);
	});

	test("wins over a mapping that accepts the plugin, for its applets and its saved settings", async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-dropped.sql");
		const deezer: Mapping<string> = {
			plugin: "source",
			accepts: (name) => name === "deezer",
			persistent: (v1) => ({ grant: { service: "deezer", fields: { auth: v1.auth ?? null } } }),
			instance: () => ({ settings: { playlist: "Mix", filter: "" } }),
		};

		expect(await importWith(h.options(), [...fixtureMappings, deezer])).toMatchObject({
			imported: 0,
		});
		const [accountId] = await v1ImportStore(h.db).accountIds();
		expect(await h.db.storeFor(accountId ?? "").credentials.get("deezer")).toBeUndefined();
	});

	test("keeps Deezer's and spotify mixer's saved auth out of the report, the log and the marker", async () => {
		const { h, markdown } = await imported();
		const marker = JSON.stringify(await v1ImportStore(h.db).marker());
		const log = JSON.stringify(h.logger.lines);

		for (const secret of ["DEEZER-TOKEN-5a8b", "MIXER-TOKEN-3c6d"]) {
			expect(markdown).not.toContain(secret);
			expect(marker).not.toContain(secret);
			expect(log).not.toContain(secret);
		}
	});
});
