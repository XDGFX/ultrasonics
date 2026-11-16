import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import { officialPlugins } from "@ultrasonics/registry";
import { importWith } from "../import-v1.ts";
import { MAPPINGS } from "../mapping.ts";
import { REPORT_FILE } from "../report.ts";
import { buildV1Database, fixtureMappings, fixturePlugins, useImport } from "../test-support.ts";
import { THRESHOLDS_NOTE } from "./playlist-merger.ts";

const harness = useImport();

test("v1 playlist merger applets import with an empty modifier, whatever their ratio, and the report notes it once", async () => {
	const h = await harness();
	buildV1Database(h.v1Path, "v1-playlist-merger.sql");
	const merger = (await officialPlugins["playlist-merger"].load()).default;
	const outcome = await importWith(
		h.options({ plugins: new Map([...fixturePlugins, ["playlist-merger", merger]]) }),
		[...MAPPINGS, ...fixtureMappings],
	);

	expect(outcome).toMatchObject({ kind: "imported", imported: 3, skipped: 0 });
	const [accountId] = await v1ImportStore(h.db).accountIds();
	const applets = await h.db.storeFor(accountId ?? "").applets.list();
	expect(applets.map((applet) => applet.name)).toEqual([
		"Blank ratio",
		"Ratio 85",
		"Placeholder ratio",
	]);
	for (const applet of applets) {
		expect(applet.definition.modifiers).toEqual([{ plugin: "playlist-merger", settings: {} }]);
	}
	const markdown = readFileSync(join(h.dataDir, REPORT_FILE), "utf8");
	expect(markdown.split(THRESHOLDS_NOTE).length - 1).toBe(1);
});
