import { describe, expect, test } from "bun:test";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import type { Plugin } from "@ultrasonics/plugin-sdk";
import { officialPlugins } from "@ultrasonics/registry";
import { importWith } from "../import-v1.ts";
import { MAPPINGS } from "../mapping.ts";
import { buildV1Database, fixtureMappings, fixturePlugins, useImport } from "../test-support.ts";

describe("the log tracks mapping", () => {
	const harness = useImport();

	test("imports v1 log tracks outputs at any version with empty settings", async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-log-tracks.sql");
		const plugins = new Map<string, Plugin>([
			...fixturePlugins,
			["log-tracks", (await officialPlugins["log-tracks"].load()).default],
		]);

		const outcome = await importWith(
			{
				db: h.db,
				plugins,
				dataDir: h.dataDir,
				env: {},
				authSource: "bootstrapped",
				logger: h.logger,
			},
			[...fixtureMappings, ...MAPPINGS],
		);

		expect(outcome).toMatchObject({ kind: "imported", imported: 2, skipped: 0 });
		const [accountId] = await v1ImportStore(h.db).accountIds();
		if (!accountId) throw new Error("no account");
		const applets = await h.db.storeFor(accountId).applets.list();
		expect(applets.map((applet) => applet.definition.outputs)).toEqual([
			[{ plugin: "log-tracks", settings: {} }],
			[{ plugin: "log-tracks", settings: {} }],
		]);
	});
});
