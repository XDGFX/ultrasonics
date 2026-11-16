import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import type { Plugin } from "@ultrasonics/plugin-sdk";
import { officialPlugins } from "@ultrasonics/registry";
import { importV1 } from "../index.ts";
import { buildV1Database, useImport } from "../test-support.ts";
import { musicDirNote } from "./local-music-database.ts";

const harness = useImport();

const plugins = new Map<string, Plugin>(
	await Promise.all(
		Object.entries(officialPlugins).map(
			async ([name, entry]) => [name, (await entry.load()).default] as const,
		),
	),
);

test("imports music_dir as the music folder, drops fuzzy_ratio, and reminds it is v1's path", async () => {
	const h = await harness();
	buildV1Database(h.v1Path, "v1-local-music-database.sql");
	const outcome = await importV1(h.options({ plugins }));
	if (outcome.kind !== "imported") throw new Error(`expected an import, got ${outcome.kind}`);

	const [accountId] = await v1ImportStore(h.db).accountIds();
	if (!accountId) throw new Error("no account");
	const store = h.db.storeFor(accountId);
	expect(await store.pluginSettings.get("local-music-database")).toEqual({ musicDir: "/music" });
	const report = readFileSync(outcome.reportPath, "utf8");
	expect(report).toContain(musicDirNote("/music"));
	expect(report).not.toContain("fuzzy");
	// The applet's own Spotify input and local playlists output import with their tickets' mappings.
	expect(report).not.toContain("local music database 0.1, which v2 can't import");
});
