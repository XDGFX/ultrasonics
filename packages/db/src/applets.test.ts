import { describe, expect, test } from "bun:test";
import { ZodError } from "zod";
import { definition, schedule, seed, useTempDir, useTwoAccounts } from "./test-support.ts";

describe("store.applets", () => {
	const twoAccounts = useTwoAccounts(useTempDir());

	test("create, get, list, update and remove an applet", async () => {
		const { db, mine } = await twoAccounts();
		const applets = db.storeFor(mine).applets;

		const created = await applets.create({ name: "Weekly", definition });
		expect(created).toMatchObject({
			name: "Weekly",
			enabled: true,
			definition,
			schedule: null,
			nextRunAt: null,
			webhookTokenHash: null,
		});
		expect(await applets.get(created.id)).toEqual(created);

		const renamed = await applets.update(created.id, { name: "Fortnightly", enabled: false });
		expect(renamed).toMatchObject({ name: "Fortnightly", enabled: false, definition });
		expect((await applets.list()).map((applet) => applet.name)).toEqual(["Fortnightly"]);

		expect(await applets.remove(created.id)).toBe(true);
		expect(await applets.get(created.id)).toBeUndefined();
		expect(await applets.remove(created.id)).toBe(false);
	});

	test.each([
		["no input", { ...definition, inputs: [] }],
		["no output", { ...definition, outputs: [] }],
		["a slot without a plugin", { ...definition, modifiers: [{ plugin: "", settings: {} }] }],
		["a missing modifiers list", { inputs: definition.inputs, outputs: definition.outputs }],
	])("rejects a definition with %s on create and update", async (_, invalid) => {
		const { db, mine } = await twoAccounts();
		const applets = db.storeFor(mine).applets;
		// @ts-expect-error the invalid definition is the point
		await expect(applets.create({ name: "Bad", definition: invalid })).rejects.toBeInstanceOf(
			ZodError,
		);

		const applet = await applets.create({ name: "Good", definition });
		// @ts-expect-error the invalid definition is the point
		await expect(applets.update(applet.id, { definition: invalid })).rejects.toBeInstanceOf(
			ZodError,
		);
		expect(await applets.list()).toEqual([applet]);
	});

	test("a slot's settings round-trip unchanged, even when meaningless", async () => {
		const { db, mine } = await twoAccounts();
		const meaningless = { inputs: [{ plugin: "spotify", settings: [1, "two", { three: null }] }] };
		const odd = { ...definition, ...meaningless };

		const applet = await db.storeFor(mine).applets.create({ name: "Odd", definition: odd });

		expect((await db.storeFor(mine).applets.get(applet.id))?.definition).toEqual(odd);
	});

	test.each([
		["definition", "{}"],
		["schedule", '{"kind":"cron"}'],
	])("a stored %s that no longer parses throws on read", async (column, stored) => {
		const { db, mine, path } = await twoAccounts();
		const { id } = await db.storeFor(mine).applets.create({ name: "Drifted", definition });
		seed(path, `UPDATE applets SET ${column} = ? WHERE id = ?`, stored, id);

		await expect(db.storeFor(mine).applets.get(id)).rejects.toBeInstanceOf(ZodError);
	});

	test("setSchedule sets and clears the schedule with next_run_at", async () => {
		const { db, mine } = await twoAccounts();
		const applets = db.storeFor(mine).applets;
		const { id } = await applets.create({ name: "Daily", definition });

		expect(await applets.setSchedule(id, { schedule, nextRunAt: 1_000 })).toBe(true);
		expect(await applets.get(id)).toMatchObject({ schedule, nextRunAt: 1_000 });

		expect(await applets.setSchedule(id, null)).toBe(true);
		expect(await applets.get(id)).toMatchObject({ schedule: null, nextRunAt: null });
	});

	test.each([
		["a count of zero", { ...schedule, count: 0 }],
		["a fractional count", { ...schedule, count: 1.5 }],
		["an unknown unit", { ...schedule, unit: "minute" }],
		["an anchor with a zone", { ...schedule, anchor: "2026-11-01T03:00:00Z" }],
		["an unknown time zone", { ...schedule, timeZone: "Mars/Olympus_Mons" }],
		["an unknown kind", { ...schedule, kind: "cron" }],
	])("rejects a schedule with %s", async (_, invalid) => {
		const { db, mine } = await twoAccounts();
		const applets = db.storeFor(mine).applets;
		const { id } = await applets.create({ name: "Daily", definition });

		// @ts-expect-error the invalid schedule is the point
		const setting = applets.setSchedule(id, { schedule: invalid, nextRunAt: 1 });
		await expect(setting).rejects.toBeInstanceOf(ZodError);
		expect(await applets.get(id)).toMatchObject({ schedule: null, nextRunAt: null });
	});

	test("setNextRunAt and setWebhookTokenHash set and clear their columns", async () => {
		const { db, mine } = await twoAccounts();
		const applets = db.storeFor(mine).applets;
		const { id } = await applets.create({ name: "Hooked", definition });

		expect(await applets.setNextRunAt(id, 5_000)).toBe(true);
		expect(await applets.setWebhookTokenHash(id, "hash")).toBe(true);
		expect(await applets.get(id)).toMatchObject({ nextRunAt: 5_000, webhookTokenHash: "hash" });

		await applets.setNextRunAt(id, null);
		await applets.setWebhookTokenHash(id, null);
		expect(await applets.get(id)).toMatchObject({ nextRunAt: null, webhookTokenHash: null });
	});
});
