import { describe, expect, test } from "bun:test";
import { type AccountStore, RUNS_KEPT_PER_APPLET } from "@ultrasonics/db";
import { definition, journal, useTempDir, useTwoAccounts } from "./test-support.ts";

describe("store.runs", () => {
	const twoAccounts = useTwoAccounts(useTempDir());

	async function withApplet() {
		const { db, mine } = await twoAccounts();
		const store = db.storeFor(mine);
		const applet = await store.applets.create({ name: "Weekly", definition });
		return { store, appletId: applet.id };
	}

	async function startRun(runs: AccountStore["runs"], appletId: string) {
		const id = await runs.start(appletId, "schedule");
		if (!id) throw new Error("run did not start");
		return id;
	}

	test("start records a running run with its trigger", async () => {
		const { store, appletId } = await withApplet();

		const id = await store.runs.start(appletId, "webhook");

		expect(await store.runs.get(id ?? "")).toMatchObject({
			appletId,
			trigger: "webhook",
			status: "running",
			finishedAt: null,
			log: null,
		});
	});

	test("checkpoint persists the journal before finish", async () => {
		const { store, appletId } = await withApplet();
		const id = await startRun(store.runs, appletId);

		expect(await store.runs.checkpoint(id, journal)).toBe(true);

		expect(await store.runs.get(id)).toMatchObject({ status: "running", ...journal });
	});

	test("finish writes the final status and journal", async () => {
		const { store, appletId } = await withApplet();
		const id = await startRun(store.runs, appletId);
		const final = { ...journal, results: [{ playlist: "Weekly", outcome: "written" }] };

		expect(await store.runs.finish(id, "partial", final)).toBe(true);

		const run = await store.runs.get(id);
		expect(run).toMatchObject({ status: "partial", ...final });
		expect(run?.finishedAt).toBeNumber();
	});

	test("listForApplet lists newest first, without the journal", async () => {
		const { store, appletId } = await withApplet();
		const first = await startRun(store.runs, appletId);
		const second = await startRun(store.runs, appletId);
		await store.runs.checkpoint(first, journal);

		const listed = await store.runs.listForApplet(appletId);

		expect(listed.map((run) => run.id)).toEqual([second, first]);
		expect(listed[1]).not.toHaveProperty("log");
		expect(listed[1]).not.toHaveProperty("stages");
		expect(listed[1]).not.toHaveProperty("results");
	});

	test("finishing a run keeps the newest finished runs and never deletes a running one", async () => {
		const { store, appletId } = await withApplet();
		const running = await startRun(store.runs, appletId);
		const finished: string[] = [];
		for (let i = 0; i < RUNS_KEPT_PER_APPLET; i++) {
			const id = await startRun(store.runs, appletId);
			await store.runs.finish(id, "succeeded", journal);
			finished.push(id);
		}
		const other = await store.applets.create({ name: "Other", definition });
		const otherRun = await startRun(store.runs, other.id);
		await store.runs.finish(otherRun, "succeeded", journal);

		const last = await startRun(store.runs, appletId);
		await store.runs.finish(last, "failed", journal);

		const kept = (await store.runs.listForApplet(appletId)).map((run) => run.id);
		expect(kept).toHaveLength(RUNS_KEPT_PER_APPLET + 1);
		expect(kept).toContain(running);
		expect(kept).toContain(last);
		expect(kept).not.toContain(finished[0]);
		expect(await store.runs.listForApplet(other.id)).toHaveLength(1);
	});

	test("deleting an applet deletes its runs", async () => {
		const { store, appletId } = await withApplet();
		const id = await startRun(store.runs, appletId);

		await store.applets.remove(appletId);

		expect(await store.runs.get(id)).toBeUndefined();
	});

	test("start returns nothing for an applet that does not exist", async () => {
		const { store } = await withApplet();
		expect(await store.runs.start("missing", "manual")).toBeUndefined();
	});
});
