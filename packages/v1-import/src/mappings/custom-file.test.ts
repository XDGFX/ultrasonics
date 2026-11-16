import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import { officialPlugins } from "@ultrasonics/registry";
import { importWith } from "../import-v1.ts";
import { MAPPINGS } from "../mapping.ts";
import { REPORT_FILE } from "../report.ts";
import { buildV1Database, fixtureMappings, fixturePlugins, useImport } from "../test-support.ts";

describe("the custom file mapping", () => {
	const harness = useImport();

	const imported = async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-custom-file.sql");
		const plugin = (await officialPlugins["custom-file"].load()).default;
		// The fixture source stands in for an input, since an applet without one is skipped.
		const outcome = await importWith(
			{
				db: h.db,
				plugins: new Map([...fixturePlugins, [plugin.name, plugin]]),
				dataDir: h.dataDir,
				env: {},
				authSource: "bootstrapped",
				logger: h.logger,
			},
			[...MAPPINGS, ...fixtureMappings],
		);
		const [accountId] = await v1ImportStore(h.db).accountIds();
		if (!accountId) throw new Error("no account");
		const applets = await h.db.storeFor(accountId).applets.list();
		const outputOf = (name: string) =>
			applets.find((applet) => applet.name === name)?.definition.outputs;
		return { outcome, outputOf, markdown: readFileSync(join(h.dataDir, REPORT_FILE), "utf8") };
	};

	test("imports v1's settings with the same patterns, for each existing_files value", async () => {
		const { outcome, outputOf } = await imported();

		expect(outcome).toMatchObject({ kind: "imported", imported: 3, skipped: 0 });
		expect(outputOf("Overwrite")).toEqual([
			{
				plugin: "custom-file",
				settings: {
					dir: "/mnt/playlists",
					existing: "overwrite",
					fileName: "{name}.txt",
					pattern: "{artist} - {title} (ISRC: {isrc})",
				},
			},
		]);
		expect(outputOf("Append")).toEqual([
			{
				plugin: "custom-file",
				settings: {
					dir: "/mnt/lists",
					existing: "append",
					fileName: "songs.csv",
					pattern: "{title},{id.spotify}",
				},
			},
		]);
	});

	test("imports a .db file name as written, and reports it as failing its schema", async () => {
		const { outputOf, markdown } = await imported();

		expect(outputOf("Database")?.[0]?.settings).toMatchObject({ fileName: "ultrasonics.db" });
		const failures = markdown.slice(markdown.indexOf("## Settings that failed"));
		expect(failures).toContain("Database, outputs 1 (custom-file): `fileName`");
		expect(failures).not.toContain("Overwrite, outputs");
		expect(failures).not.toContain("Append, outputs");
	});
});
