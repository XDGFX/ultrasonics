import { Database as Sqlite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import { importV1 } from "./index.ts";
import { FURTHER_TIME_TRIGGER_NOTE } from "./plan.ts";
import { REPORT_FILE } from "./report.ts";
import {
	buildV1Database,
	EXPLOSION,
	fixturePlugins,
	type ImportHarness,
	RECOGNISABLE_TOKEN,
	useImport,
} from "./test-support.ts";
import { PLUS_NOTE } from "./v1-filter.ts";

const sha256 = (path: string) =>
	new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

/** The lines under one `##` heading of the report, up to the next. */
function section(markdown: string, heading: string): string {
	const start = markdown.indexOf(`\n## ${heading}\n`);
	if (start === -1) return "";
	const end = markdown.indexOf("\n## ", start + 1);
	return markdown.slice(start, end === -1 ? undefined : end);
}

async function accountOf(harness: ImportHarness): Promise<string> {
	const [accountId] = await v1ImportStore(harness.db).accountIds();
	if (!accountId) throw new Error("no account");
	return accountId;
}

describe("importV1", () => {
	const harness = useImport();

	describe("a fixture install", () => {
		const imported = async () => {
			const h = await harness();
			buildV1Database(h.v1Path);
			const before = sha256(h.v1Path);
			const outcome = await h.run({ env: { TZ: "Australia/Sydney" } });
			const markdown = readFileSync(join(h.dataDir, REPORT_FILE), "utf8");
			const store = h.db.storeFor(await accountOf(h));
			return { h, before, outcome, markdown, store };
		};

		test("imports every mappable applet disabled, in v1's order, and skips the rest", async () => {
			const { outcome, store } = await imported();

			expect(outcome).toMatchObject({ kind: "imported", imported: 7, skipped: 4 });
			const applets = await store.applets.list();
			expect(applets.map((applet) => applet.name)).toEqual([
				"Daily",
				"Cal's old source",
				"Hourly-ish",
				"Monthly",
				"Hooked",
				"Bad library",
				"Manual filter",
			]);
			expect(applets.every((applet) => !applet.enabled && applet.nextRunAt === null)).toBe(true);
			expect(applets.map((applet) => applet.id)).not.toContain("a1");
			expect(applets[0]?.definition).toEqual({
				inputs: [{ plugin: "source", settings: { playlist: "Chill", filter: "chill*" } }],
				modifiers: [],
				outputs: [{ plugin: "sink", settings: { library: "Music [3]" } }],
			});
		});

		test("turns time triggers into schedules in TZ, keeping the first, and imports an applet with none", async () => {
			const { store } = await imported();
			const scheduleOf = async (name: string) =>
				(await store.applets.list()).find((applet) => applet.name === name)?.schedule;

			expect(await scheduleOf("Daily")).toEqual({
				kind: "interval",
				unit: "day",
				count: 1,
				anchor: "2021-03-01T07:30:00",
				timeZone: "Australia/Sydney",
			});
			// A blank start anchors at the import time, 02:48:52 UTC.
			expect(await scheduleOf("Hourly-ish")).toEqual({
				kind: "interval",
				unit: "hour",
				count: 2,
				anchor: "2026-11-16T13:48:52",
				timeZone: "Australia/Sydney",
			});
			expect(await scheduleOf("Monthly")).toMatchObject({ unit: "day", count: 61 });
			expect(await scheduleOf("Cal's old source")).toBeNull();
			expect(await scheduleOf("Hooked")).toBeNull();
		});

		test("takes plugin settings and the grant from the newest version with settings", async () => {
			const { store } = await imported();

			expect(await store.pluginSettings.get("source")).toEqual({ region: "au" });
			expect((await store.credentials.get("fixture"))?.document).toEqual({
				token: RECOGNISABLE_TOKEN,
			});
		});

		test("stores a value that fails its schema anyway", async () => {
			const { store } = await imported();
			const bad = (await store.applets.list()).find((applet) => applet.name === "Bad library");

			expect(bad?.definition.outputs).toEqual([{ plugin: "sink", settings: { library: "" } }]);
		});

		test("reports each skip with its reason and v1 config, and every conversion", async () => {
			const { markdown } = await imported();
			const skipped = section(markdown, "Skipped applets");

			expect(skipped).toContain("### TIDAL fork");
			expect(skipped).toContain("tidal 0.3");
			expect(skipped).toContain('"playlist": "Favourites"');
			expect(skipped).toContain("### Broken mapping");
			expect(skipped).toContain(EXPLOSION);
			expect(skipped).toContain("### No output");
			expect(skipped).toContain("### v1 applet a11");
			expect(skipped).toContain("offset 38");

			// v1's `version` row, which no other part of the fixture holds.
			expect(markdown).toContain("1.0.0-rc.1");
			expect(section(markdown, "Services to reconnect")).toContain("- Fixture");
			expect(section(markdown, "Webhooks dropped")).toContain("- Hooked");
			const schedules = section(markdown, "Schedules");
			expect(schedules).toContain("Australia/Sydney");
			expect(schedules).toContain("- Hourly-ish:");
			expect(schedules).toContain("- Monthly:");
			expect(schedules).not.toContain("- Daily:");
			expect(section(markdown, "Imported applets")).toContain(FURTHER_TIME_TRIGGER_NOTE);
			expect(section(markdown, "Filters that need a manual edit")).toContain(
				"- Manual filter: `[Cc]hill`",
			);
			const failures = section(markdown, "Settings that failed their plugin's checks");
			expect(failures).toContain("Bad library, outputs 1 (sink): `library`");
			// The older version, the newer one whose settings won, and the applet that used the older.
			const pluginSettings = section(markdown, "Plugin settings");
			expect(pluginSettings).toContain("fixture source 0.9");
			expect(pluginSettings).toContain("fixture source 1.0");
			expect(pluginSettings).toContain("Cal's old source");
		});

		test("leaves v1's file byte-identical and keeps its credentials and private URL out of the report, the log and the marker", async () => {
			const { h, before, markdown } = await imported();

			expect(sha256(h.v1Path)).toBe(before);
			const marker = JSON.stringify(await v1ImportStore(h.db).marker());
			const log = JSON.stringify(h.logger.lines);
			for (const secret of [
				RECOGNISABLE_TOKEN,
				"OLD-TOKEN-7c41",
				"SPOTIFY-TOKEN-9d03",
				"private-api.lan",
			]) {
				expect(markdown).not.toContain(secret);
				expect(marker).not.toContain(secret);
				expect(log).not.toContain(secret);
			}
		});

		test("writes the marker with the report and summarises it in the boot log", async () => {
			const { h, markdown } = await imported();

			expect(await v1ImportStore(h.db).marker()).toEqual({
				importedAt: Date.UTC(2026, 10, 16, 2, 48, 52),
				report: { imported: 7, skipped: 4, markdown },
				dismissed: false,
			});
			expect(h.logger.lines).toEqual([
				{ level: "warn", message: expect.stringContaining(join(h.dataDir, REPORT_FILE)) },
			]);
		});

		test("a second boot imports nothing", async () => {
			const { h, store } = await imported();

			expect(await h.run()).toEqual({ kind: "already-imported" });
			expect(await store.applets.list()).toHaveLength(7);
		});
	});

	test("notes .+ from the filter converter on the imported applet", async () => {
		const h = await harness();
		buildV1Database(h.v1Path, "v1-plus-filter.sql");

		expect(await h.run()).toMatchObject({ kind: "imported", imported: 1 });
		const markdown = readFileSync(join(h.dataDir, REPORT_FILE), "utf8");
		expect(section(markdown, "Imported applets")).toContain(PLUS_NOTE);
	});

	test("no v1 database means no import, no marker and no report", async () => {
		const h = await harness();

		expect(await h.run()).toEqual({ kind: "no-v1-database" });
		expect(await v1ImportStore(h.db).marker()).toBeUndefined();
		expect(existsSync(join(h.dataDir, REPORT_FILE))).toBe(false);
		expect(h.logger.lines).toEqual([]);
	});

	test("reads V1_DATABASE when it is set", async () => {
		const h = await harness();
		const elsewhere = join(h.dataDir, "v1-backup.db");
		buildV1Database(elsewhere);

		expect(await h.run({ env: { V1_DATABASE: elsewhere } })).toMatchObject({ kind: "imported" });
	});

	test.each([
		["a database without v1's tables", (path: string) => buildV1Database(path, "not-v1.sql")],
		[
			"a file that is not a database",
			(path: string) => writeFileSync(path, "not sqlite at all, just text".repeat(20)),
		],
	])("aborts on %s, logging an error and writing nothing", async (_, make) => {
		const h = await harness();
		make(h.v1Path);
		const before = sha256(h.v1Path);

		expect(await h.run()).toMatchObject({ kind: "aborted" });
		expect(h.logger.lines).toEqual([
			{ level: "error", message: expect.stringContaining(h.v1Path) },
		]);
		expect(await v1ImportStore(h.db).marker()).toBeUndefined();
		expect(existsSync(join(h.dataDir, REPORT_FILE))).toBe(false);
		expect(sha256(h.v1Path)).toBe(before);
	});

	test("refuses under AUTH_SOURCE=oauth, and says why", async () => {
		const h = await harness();
		buildV1Database(h.v1Path);

		expect(await h.run({ authSource: "oauth" })).toEqual({ kind: "refused", reason: "oauth" });
		expect(h.logger.lines).toEqual([{ level: "warn", message: expect.stringContaining(h.v1Path) }]);
		expect(await v1ImportStore(h.db).marker()).toBeUndefined();
	});

	test("refuses with more than one account, and says why", async () => {
		const h = await harness();
		buildV1Database(h.v1Path);
		const raw = new Sqlite(h.v2Path);
		raw.run("INSERT INTO accounts (id, created_at) VALUES ('second', 0)");
		raw.close();

		expect(await h.run()).toEqual({ kind: "refused", reason: "several-accounts" });
		expect(h.logger.lines).toEqual([{ level: "warn", message: expect.stringContaining(h.v1Path) }]);
	});

	test("with the shipped mappings, every applet skips as unknown", async () => {
		const h = await harness();
		buildV1Database(h.v1Path);

		const outcome = await importV1({
			db: h.db,
			plugins: fixturePlugins,
			dataDir: h.dataDir,
			env: {},
			authSource: "bootstrapped",
			logger: h.logger,
		});

		expect(outcome).toMatchObject({ kind: "imported", imported: 0, skipped: 11 });
	});
});
