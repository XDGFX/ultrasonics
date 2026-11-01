import { describe, expect, test } from "bun:test";
import { definition, journal, schedule, useTempDir, useTwoAccounts } from "./test-support.ts";

/** ADR-0003: another account's rows behave exactly as if they did not exist. */
describe("storeFor scoping", () => {
	const twoAccounts = useTwoAccounts(useTempDir());

	async function populated() {
		const { db, mine, theirs } = await twoAccounts();
		const fill = async (accountId: string, label: string) => {
			const store = db.storeFor(accountId);
			const applet = await store.applets.create({ name: label, definition });
			const runId = await store.runs.start(applet.id, "manual");
			if (!runId) throw new Error("run did not start");
			await store.credentials.put("spotify", { accessToken: label }, 1);
			await store.pluginSettings.put("plex", { owner: label });
			return { appletId: applet.id, runId };
		};
		return {
			db,
			mine: await fill(mine, "mine"),
			theirs: await fill(theirs, "theirs"),
			ids: { mine, theirs },
		};
	}

	test("reads see only the account's own rows", async () => {
		const { db, mine, ids } = await populated();
		const store = db.storeFor(ids.mine);

		expect((await store.applets.list()).map((applet) => applet.id)).toEqual([mine.appletId]);
		expect(await store.credentials.get("spotify")).toHaveProperty("document", {
			accessToken: "mine",
		});
		expect(await store.pluginSettings.get("plex")).toEqual({ owner: "mine" });
		expect((await store.runs.listForApplet(mine.appletId)).map((run) => run.id)).toEqual([
			mine.runId,
		]);
	});

	test("another account's applet and run are not found by any method", async () => {
		const { db, theirs, ids } = await populated();
		const store = db.storeFor(ids.mine);
		const { appletId, runId } = theirs;

		expect(await store.applets.get(appletId)).toBeUndefined();
		expect(await store.applets.update(appletId, { name: "stolen" })).toBeUndefined();
		expect(await store.applets.setSchedule(appletId, { schedule, nextRunAt: 1 })).toBe(false);
		expect(await store.applets.setNextRunAt(appletId, 1)).toBe(false);
		expect(await store.applets.setWebhookTokenHash(appletId, "stolen")).toBe(false);
		expect(await store.applets.remove(appletId)).toBe(false);
		expect(await store.runs.start(appletId, "manual")).toBeUndefined();
		expect(await store.runs.listForApplet(appletId)).toEqual([]);
		expect(await store.runs.get(runId)).toBeUndefined();
		expect(await store.runs.checkpoint(runId, journal)).toBe(false);
		expect(await store.runs.finish(runId, "failed", journal)).toBe(false);
	});

	test("changes through one account leave the other's rows untouched", async () => {
		const { db, theirs, ids } = await populated();
		const store = db.storeFor(ids.mine);
		const before = await db.storeFor(ids.theirs).applets.get(theirs.appletId);

		await store.applets.update(theirs.appletId, { name: "stolen" });
		await store.applets.setSchedule(theirs.appletId, { schedule, nextRunAt: 1 });
		await store.applets.remove(theirs.appletId);
		await store.runs.finish(theirs.runId, "failed", journal);
		expect(await store.credentials.remove("spotify")).toBe(true);
		expect(await store.pluginSettings.remove("plex")).toBe(true);
		await store.credentials.put("lastfm", { accessToken: "mine" }, null);

		const theirStore = db.storeFor(ids.theirs);
		expect(await theirStore.applets.get(theirs.appletId)).toEqual(before);
		expect(await theirStore.runs.get(theirs.runId)).toMatchObject({ status: "running" });
		expect(await theirStore.credentials.get("spotify")).toHaveProperty("document", {
			accessToken: "theirs",
		});
		expect(await theirStore.credentials.get("lastfm")).toBeUndefined();
		expect(await theirStore.pluginSettings.get("plex")).toEqual({ owner: "theirs" });
	});
});
