import { Database as Sqlite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import type { Plugin } from "@ultrasonics/plugin-sdk";
import { officialPlugins } from "@ultrasonics/registry";
import { importV1 } from "../index.ts";
import { REPORT_FILE } from "../report.ts";
import { buildV1Database, type ImportHarness, useImport } from "../test-support.ts";
import {
	LOCAL_ROOT_NOTE,
	ONE_ROOT_NOTE,
	RECURSIVE_OUTPUT_NOTE,
	UNKNOWN_RETENTION_NOTE,
} from "./local-playlists.ts";

const plugins = new Map<string, Plugin>([
	["local-playlists", (await officialPlugins["local-playlists"].load()).default],
]);

async function imported(h: ImportHarness) {
	const outcome = await importV1({
		db: h.db,
		plugins,
		dataDir: h.dataDir,
		env: {},
		authSource: "bootstrapped",
		logger: h.logger,
	});
	const [accountId] = await v1ImportStore(h.db).accountIds();
	if (!accountId) throw new Error("no account");
	const markdown = readFileSync(join(h.dataDir, REPORT_FILE), "utf8");
	return { outcome, store: h.db.storeFor(accountId), markdown };
}

describe("importing v1's local playlists", () => {
	const harness = useImport();

	test("maps each applet's input and output, converting filters v1 matched from the start", async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-local-playlists.sql");

		const { outcome, store, markdown } = await imported(h);

		expect(outcome).toMatchObject({ kind: "imported", imported: 3, skipped: 0 });
		const definitions = (await store.applets.list()).map((applet) => applet.definition);
		const local = (settings: object) => [{ plugin: "local-playlists", settings }];
		const folder = "/mnt/music library/playlists";
		const synced = "/mnt/music library/synced";
		expect(definitions).toEqual([
			{
				inputs: local({ dir: folder, recursive: true, filter: "disco*" }),
				modifiers: [],
				outputs: local({ dir: synced, backups: "5" }),
			},
			{
				inputs: local({ dir: folder, recursive: false, filter: "rock*, pop*" }),
				modifiers: [],
				outputs: local({ dir: synced, backups: "0" }),
			},
			{
				inputs: local({ dir: folder, recursive: false, filter: "\\d{4}$" }),
				modifiers: [],
				outputs: local({ dir: synced, backups: "3" }),
			},
		]);
		expect(markdown).toContain("- Years: `\\d{4}$`.");
		expect(markdown).toContain(RECURSIVE_OUTPUT_NOTE);
		expect(markdown.split(RECURSIVE_OUTPUT_NOTE)).toHaveLength(2);
	});

	test("imports v1's prepends as the path mapping, reminding that localRoot is v1's container path", async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-local-playlists.sql");

		const { store, markdown } = await imported(h);

		const value = await store.pluginSettings.get("local-playlists");
		expect(value).toEqual({ playlistRoot: "D:/Music", localRoot: "/mnt/music library/music" });
		expect(plugins.get("local-playlists")?.persistentSettings?.safeParse(value).success).toBe(true);
		expect(markdown).toContain(LOCAL_ROOT_NOTE);
	});

	test("drops both prepends when v1 had only one, and notes a retention it doesn't know", async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-local-playlists.sql");
		const v1 = new Sqlite(h.v1Path);
		v1.run(
			"UPDATE plugins SET settings = '{''local_prepend'': '''', ''ultrasonics_prepend'': ''/music''}'",
		);
		v1.run("UPDATE applets SET data = replace(data, '3 Backups', 'Forever') WHERE id = 'l3'");
		v1.close();

		const { store, markdown } = await imported(h);

		expect(await store.pluginSettings.get("local-playlists")).toBeUndefined();
		expect(markdown).toContain(ONE_ROOT_NOTE);
		expect(markdown).not.toContain(LOCAL_ROOT_NOTE);
		const years = (await store.applets.list()).find((applet) => applet.name === "Years");
		expect(years?.definition.outputs[0]?.settings).toEqual({ dir: "/mnt/music library/synced" });
		expect(markdown).toContain(UNKNOWN_RETENTION_NOTE);
	});
});
