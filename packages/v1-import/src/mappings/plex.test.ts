import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import type { Plugin } from "@ultrasonics/plugin-sdk";
import { officialPlugins } from "@ultrasonics/registry";
import { importWith } from "../import-v1.ts";
import type { Mapping } from "../mapping.ts";
import { REPORT_FILE } from "../report.ts";
import {
	buildV1Database,
	fixtureMappings,
	fixturePlugins,
	type ImportHarness,
	useImport,
} from "../test-support.ts";
import { LEGACY_PATHS_NOTE, plexMapping } from "./plex.ts";

/** A stand-in for the Spotify input's mapping, which lists Spotify to reconnect. */
const spotifyStandIn: Mapping<string> = {
	plugin: "source",
	accepts: (name) => name === "spotify",
	setup: { reconnect: "Spotify" },
	instance: () => ({ settings: { playlist: "Liked", filter: "" } }),
};

const mappings = [plexMapping, ...fixtureMappings, spotifyStandIn];

describe("the Plex mapping", () => {
	const harness = useImport();

	const imported = async (fixture: string) => {
		const h: ImportHarness = await harness();
		buildV1Database(h.v1Path, fixture);
		const plex = (await officialPlugins.plex.load()).default;
		const plugins = new Map<string, Plugin>([...fixturePlugins, ["plex", plex]]);
		const outcome = await importWith(h.options({ plugins }), mappings);
		const [accountId] = await v1ImportStore(h.db).accountIds();
		if (!accountId) throw new Error("no account");
		const store = h.db.storeFor(accountId);
		const markdown = readFileSync(join(h.dataDir, REPORT_FILE), "utf8");
		const definitionOf = async (name: string) =>
			(await store.applets.list()).find((applet) => applet.name === name)?.definition;
		const outputOf = async (name: string) => (await definitionOf(name))?.outputs;
		const inputOf = async (name: string) => (await definitionOf(name))?.inputs;
		return { h, outcome, store, markdown, outputOf, inputOf };
	};

	test("maps a Plex output's library to its section id and existing playlists to existing", async () => {
		const { outcome, outputOf } = await imported("v1-plex.sql");

		expect(outcome).toMatchObject({ kind: "imported", imported: 4, skipped: 0 });
		expect(await outputOf("Chill to Plex")).toEqual([
			{ plugin: "plex", settings: { library: "3", existing: "update" } },
		]);
		expect(await outputOf("Spotify to Plex")).toEqual([
			{ plugin: "plex", settings: { library: "3", existing: "append" } },
		]);
	});

	test("keeps a library without an id as written, and a legacy output updates as v1's did", async () => {
		const { outputOf } = await imported("v1-plex.sql");

		expect(await outputOf("Old Plex")).toEqual([
			{ plugin: "plex", settings: { library: "Music", existing: "update" } },
		]);
	});

	test("maps plex legacy 0.1 and plex 1.0 outputs too", async () => {
		const { outcome, outputOf } = await imported("v1-plex-legacy.sql");

		expect(outcome).toMatchObject({ kind: "imported", imported: 1, skipped: 0 });
		expect(await outputOf("Legacy library")).toEqual([
			{ plugin: "plex", settings: { library: "7", existing: "update" } },
			{ plugin: "plex", settings: { library: "Music", existing: "append" } },
		]);
	});

	test("writes the plex grant from v1.0's server when two servers differ, naming the applets that move", async () => {
		const { store, markdown } = await imported("v1-plex.sql");

		expect((await store.credentials.get("plex"))?.document).toEqual({
			serverUrl: "http://plex.lan:32400",
			token: "PLEX-NEW-TOKEN-5a8b",
			verifyTls: true,
		});
		expect(markdown).toMatch(/plex 0\.1 [^\n]*plex beta 1\.0[^\n]*: Old Plex\.\n/);
	});

	test("reports dropped legacy paths on each applet that used them, even when that server lost", async () => {
		const { markdown } = await imported("v1-plex.sql");

		expect(markdown).toContain(`- **Old Plex**\n  - ${LEGACY_PATHS_NOTE}\n`);
		expect(markdown.split(LEGACY_PATHS_NOTE)).toHaveLength(2);
	});

	test("takes verifyTls from a legacy server's check_ssl, and reports its dropped paths", async () => {
		const { store, markdown } = await imported("v1-plex-legacy.sql");

		expect((await store.credentials.get("plex"))?.document).toEqual({
			serverUrl: "https://plex.lan:32400",
			token: "PLEX-LEGACY-TOKEN-0c19",
			verifyTls: false,
		});
		expect(markdown).toContain(`- **Legacy library**\n  - ${LEGACY_PATHS_NOTE}\n`);
	});

	test("lists Spotify to reconnect, and no Plex token reaches the report, the log or the marker", async () => {
		const { h, markdown } = await imported("v1-plex.sql");
		const marker = JSON.stringify(await v1ImportStore(h.db).marker());
		const log = JSON.stringify(h.logger.lines);

		expect(markdown).toMatch(/## Services to reconnect\n[^#]*\n- Spotify\n/);
		for (const secret of ["PLEX-NEW-TOKEN-5a8b", "PLEX-OLD-TOKEN-3e77"]) {
			for (const text of [markdown, log, marker]) expect(text).not.toContain(secret);
		}
	});

	test("maps a Plex input with a blank filter to all, dropping its library", async () => {
		const { outcome, inputOf } = await imported("v1-plex-input.sql");

		expect(outcome).toMatchObject({ kind: "imported", imported: 5, skipped: 0 });
		expect(await inputOf("Every Plex playlist")).toEqual([
			{ plugin: "plex", settings: { source: "all" } },
		]);
	});

	test("maps a plain or convertible filter to chosen, matching anywhere in the title as v1 did", async () => {
		const { inputOf } = await imported("v1-plex-input.sql");

		expect(await inputOf("Gym playlists")).toEqual([
			{ plugin: "plex", settings: { source: "chosen", playlists: "*gym*" } },
		]);
		expect(await inputOf("Chill or run")).toEqual([
			{ plugin: "plex", settings: { source: "chosen", playlists: "chill*, *run" } },
		]);
		expect(await inputOf("Beta mix")).toEqual([
			{ plugin: "plex", settings: { source: "chosen", playlists: "*Mix*" } },
		]);
	});

	test("keeps a filter that won't convert as written, and reports it for a manual edit", async () => {
		const { inputOf, markdown } = await imported("v1-plex-input.sql");

		expect(await inputOf("Numbered gym")).toEqual([
			{ plugin: "plex", settings: { source: "chosen", playlists: "gym \\d+" } },
		]);
		expect(markdown).toMatch(
			/## Filters that need a manual edit\n[^#]*- Numbered gym: `gym \\d\+`/,
		);
		expect(markdown).not.toMatch(/Filters that need a manual edit[^#]*Gym playlists/);
	});
});
