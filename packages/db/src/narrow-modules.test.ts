import { describe, expect, test } from "bun:test";
import { authStore } from "@ultrasonics/db/auth-store";
import { systemModule } from "@ultrasonics/db/system";
import { definition, journal, seed, useTempDir, useTwoAccounts } from "./test-support.ts";

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

	test("interruptRunning marks only running runs interrupted, across accounts", async () => {
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

		expect(await systemModule(db).interruptRunning()).toBe(2);

		for (const { store, runId } of [mineRunning, theirsRunning]) {
			expect(await store.runs.get(runId)).toHaveProperty("status", "interrupted");
		}
		expect(await finished.store.runs.get(finished.runId)).toHaveProperty("status", "succeeded");
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
});
