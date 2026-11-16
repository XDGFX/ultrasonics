import { describe, expect, test } from "bun:test";
import { authStore } from "@ultrasonics/db/auth-store";
import { systemModule } from "@ultrasonics/db/system";
import { v1ImportStore } from "@ultrasonics/db/v1-import";
import { definition, journal, schedule, seed, useTempDir, useTwoAccounts } from "./test-support.ts";

describe("systemModule", () => {
	const twoAccounts = useTwoAccounts(useTempDir());

	test("dueApplets crosses accounts and skips disabled, future and unscheduled applets", async () => {
		const { db, mine, theirs } = await twoAccounts();
		const create = async (accountId: string, nextRunAt: number | null, enabled = true) => {
			const applets = db.storeFor(accountId).applets;
			const { id } = await applets.create({ name: "Applet", definition, enabled });
			await applets.setNextRunAt(id, nextRunAt);
			return id;
		};
		const myDue = await create(mine, 1_000);
		const theirDue = await create(theirs, 2_000);
		await create(mine, 2_001);
		await create(theirs, 500, false);
		await create(mine, null);

		const due = await systemModule(db).dueApplets(2_000);

		expect(due).toHaveLength(2);
		expect(due).toContainEqual({ accountId: mine, appletId: myDue });
		expect(due).toContainEqual({ accountId: theirs, appletId: theirDue });
	});

	test("appletForWebhookToken resolves a hash to its applet, or nothing", async () => {
		const { db, theirs } = await twoAccounts();
		const applets = db.storeFor(theirs).applets;
		const { id } = await applets.create({ name: "Hooked", definition, enabled: false });
		await applets.setWebhookTokenHash(id, "token-hash");
		const system = systemModule(db);

		expect(await system.appletForWebhookToken("token-hash")).toEqual({
			accountId: theirs,
			appletId: id,
			enabled: false,
		});
		expect(await system.appletForWebhookToken("unknown")).toBeUndefined();
	});

	test("interruptRunning marks only running runs interrupted, finished at the time given, across accounts", async () => {
		const { db, mine, theirs } = await twoAccounts();
		const startIn = async (accountId: string) => {
			const store = db.storeFor(accountId);
			const { id } = await store.applets.create({ name: "Applet", definition });
			const runId = await store.runs.start(id, "schedule");
			if (!runId) throw new Error("run did not start");
			return { store, runId };
		};
		const mineRunning = await startIn(mine);
		const theirsRunning = await startIn(theirs);
		const finished = await startIn(mine);
		await finished.store.runs.finish(finished.runId, "succeeded", journal);

		const finishedBefore = (await finished.store.runs.get(finished.runId))?.finishedAt;
		const bootedAt = 1_800_000_000_000;
		expect(await systemModule(db).interruptRunning(bootedAt)).toBe(2);

		for (const { store, runId } of [mineRunning, theirsRunning]) {
			expect(await store.runs.get(runId)).toMatchObject({
				status: "interrupted",
				finishedAt: bootedAt,
			});
		}
		expect(await finished.store.runs.get(finished.runId)).toMatchObject({
			status: "succeeded",
			finishedAt: finishedBefore,
		});
	});

	test("sweepExpiredSessions deletes only sessions expired by now", async () => {
		const { db, mine, path } = await twoAccounts();
		// Sessions have no writer until hosted login, so they are seeded directly.
		for (const [tokenHash, expiresAt] of [
			["expired", 999],
			["boundary", 1_000],
			["live", 1_001],
		] as const) {
			seed(
				path,
				"INSERT INTO sessions VALUES (?, ?, ?, 0, 0, 0, ?)",
				Bun.randomUUIDv7(),
				mine,
				tokenHash,
				expiresAt,
			);
		}

		expect(await systemModule(db).sweepExpiredSessions(1_000)).toBe(2);
		expect(await systemModule(db).sweepExpiredSessions(1_000)).toBe(0);
	});
});

describe("authStore", () => {
	const twoAccounts = useTwoAccounts(useTempDir());

	test("reads and writes instance settings by key", async () => {
		const { db } = await twoAccounts();
		const settings = authStore(db).instanceSettings;

		expect(await settings.get("spotify.clientId")).toBeUndefined();
		await settings.put("spotify.clientId", "abc123");
		await settings.put("spotify.clientId", "def456");

		expect(await settings.get("spotify.clientId")).toBe("def456");
	});

	test("putIfAbsent writes a key only while it is unset, and remove unsets it", async () => {
		const { db } = await twoAccounts();
		const settings = authStore(db).instanceSettings;

		expect(await settings.putIfAbsent("first", "a")).toBe(true);
		expect(await settings.putIfAbsent("first", "b")).toBe(false);
		expect(await settings.get("first")).toBe("a");

		expect(await settings.remove("first")).toBe(true);
		expect(await settings.remove("first")).toBe(false);
		expect(await settings.putIfAbsent("first", "c")).toBe(true);
		expect(await settings.get("first")).toBe("c");
	});
});

describe("v1ImportStore", () => {
	const twoAccounts = useTwoAccounts(useTempDir());

	test("commits applets disabled, settings, a sealed grant and the marker, then refuses a second commit", async () => {
		const { db, mine } = await twoAccounts();
		const store = v1ImportStore(db);
		const write = {
			accountId: mine,
			applets: [
				{ name: "First", definition, schedule },
				{ name: "Second", definition, schedule: null },
			],
			pluginSettings: [{ plugin: "plex", value: { library: "3" } }],
			grants: [{ service: "plex", document: { token: "sealed" } }],
			marker: { importedAt: 1 },
		};

		expect(await store.commit(write)).toBe(true);
		expect(await store.commit(write)).toBe(false);

		const scoped = db.storeFor(mine);
		const imported = await scoped.applets.list();
		expect(
			imported.map(({ name, enabled, schedule, nextRunAt }) => ({
				name,
				enabled,
				schedule,
				nextRunAt,
			})),
		).toEqual([
			{ name: "First", enabled: false, schedule, nextRunAt: null },
			{ name: "Second", enabled: false, schedule: null, nextRunAt: null },
		]);
		expect(await scoped.pluginSettings.get("plex")).toEqual({ library: "3" });
		expect((await scoped.credentials.get("plex"))?.document).toEqual({ token: "sealed" });
		expect(await store.marker()).toEqual({ importedAt: 1 });
	});

	test("a failed write leaves no marker and no applet", async () => {
		const { db, mine } = await twoAccounts();
		const store = v1ImportStore(db);
		const write = {
			accountId: mine,
			applets: [{ name: "Fine", definition, schedule: null }],
			pluginSettings: [],
			grants: [],
			// A marker that is not JSON fails inside the transaction, after the applet's insert.
			marker: { importedAt: Number.NaN },
		};

		await expect(store.commit(write)).rejects.toThrow();
		expect(await store.marker()).toBeUndefined();
		expect(await db.storeFor(mine).applets.list()).toEqual([]);
	});

	test("accountIds reads at most two", async () => {
		const { db, path } = await twoAccounts();
		seed(path, "INSERT INTO accounts (id, created_at) VALUES (?, ?)", "third", Date.now());

		expect(await v1ImportStore(db).accountIds()).toHaveLength(2);
	});

	test("an imported setting and grant replace the ones v2 already holds", async () => {
		const { db, mine } = await twoAccounts();
		const scoped = db.storeFor(mine);
		await scoped.pluginSettings.put("plex", { library: "v2" });
		await scoped.credentials.put("plex", { token: "v2" }, 1);

		await v1ImportStore(db).commit({
			accountId: mine,
			applets: [],
			pluginSettings: [{ plugin: "plex", value: { library: "v1" } }],
			grants: [{ service: "plex", document: { token: "v1" } }],
			marker: { importedAt: 1 },
		});

		expect(await scoped.pluginSettings.get("plex")).toEqual({ library: "v1" });
		expect(await scoped.credentials.get("plex")).toEqual({
			document: { token: "v1" },
			expiresAt: null,
		});
	});
});
