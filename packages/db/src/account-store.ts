import { and, asc, desc, eq, getTableColumns, ne, notInArray } from "drizzle-orm";
import { affectedRows } from "./affected-rows.ts";
import { Applet, AppletChanges, NewApplet } from "./applet.ts";
import type { Connection } from "./connection.ts";
import { CURRENT_KEY_VERSION, decryptCredential, encryptCredential } from "./credential-cipher.ts";
import { JsonObject, JsonValue } from "./json.ts";
import { type FinishedRunStatus, Run, RunJournal, RunSummary, type RunTrigger } from "./run.ts";
import { Schedule } from "./schedule.ts";
import { applets, credentials, pluginSettings, runs } from "./schema.ts";

/** ADR-0009 §5: a single constant, the same on both tiers. */
export const RUNS_KEPT_PER_APPLET = 100;

export type AccountStore = ReturnType<typeof createAccountStore>;

/** The scoped store (ADR-0009 §4): every method is bound to one account. */
export function createAccountStore(connection: Connection, accountId: string) {
	const { db } = connection;
	const ownApplet = (id: string) => and(eq(applets.accountId, accountId), eq(applets.id, id));
	const ownRun = (id: string) => and(eq(runs.accountId, accountId), eq(runs.id, id));
	const ownCredential = (service: string) =>
		and(eq(credentials.accountId, accountId), eq(credentials.service, service));
	const ownPluginSettings = (plugin: string) =>
		and(eq(pluginSettings.accountId, accountId), eq(pluginSettings.plugin, plugin));

	const setAppletColumns = async (
		id: string,
		columns: Partial<typeof applets.$inferInsert>,
	): Promise<boolean> =>
		affectedRows(
			db
				.update(applets)
				.set({ ...columns, updatedAt: Date.now() })
				.where(ownApplet(id))
				.returning({ id: applets.id }),
		) > 0;

	return {
		applets: {
			async list(): Promise<Applet[]> {
				const rows = db
					.select()
					.from(applets)
					.where(eq(applets.accountId, accountId))
					.orderBy(asc(applets.createdAt), asc(applets.id))
					.all();
				return rows.map((row) => Applet.parse(row));
			},

			async get(id: string): Promise<Applet | undefined> {
				const row = db.select().from(applets).where(ownApplet(id)).get();
				return row && Applet.parse(row);
			},

			async create(applet: NewApplet): Promise<Applet> {
				const { name, definition, enabled = true } = NewApplet.parse(applet);
				const now = Date.now();
				const row = db
					.insert(applets)
					.values({
						id: Bun.randomUUIDv7(),
						accountId,
						name,
						enabled,
						definition,
						createdAt: now,
						updatedAt: now,
					})
					.returning()
					.get();
				return Applet.parse(row);
			},

			async update(id: string, changes: AppletChanges): Promise<Applet | undefined> {
				const row = db
					.update(applets)
					.set({ ...AppletChanges.parse(changes), updatedAt: Date.now() })
					.where(ownApplet(id))
					.returning()
					.get();
				return row && Applet.parse(row);
			},

			async remove(id: string): Promise<boolean> {
				return (
					affectedRows(db.delete(applets).where(ownApplet(id)).returning({ id: applets.id })) > 0
				);
			},

			/** Sets the schedule and its first `next_run_at` together, or clears both. */
			async setSchedule(
				id: string,
				scheduled: { schedule: Schedule; nextRunAt: number } | null,
			): Promise<boolean> {
				return setAppletColumns(
					id,
					scheduled
						? { schedule: Schedule.parse(scheduled.schedule), nextRunAt: scheduled.nextRunAt }
						: { schedule: null, nextRunAt: null },
				);
			},

			async setNextRunAt(id: string, nextRunAt: number | null): Promise<boolean> {
				return setAppletColumns(id, { nextRunAt });
			},

			async setWebhookTokenHash(id: string, hash: string | null): Promise<boolean> {
				return setAppletColumns(id, { webhookTokenHash: hash });
			},
		},
		runs: {
			/** Starts a `running` run, or returns nothing if the applet is not this account's. */
			async start(appletId: string, trigger: RunTrigger): Promise<string | undefined> {
				if (!db.select({ id: applets.id }).from(applets).where(ownApplet(appletId)).get()) {
					return undefined;
				}
				const id = Bun.randomUUIDv7();
				db.insert(runs)
					.values({ id, accountId, appletId, trigger, status: "running", startedAt: Date.now() })
					.run();
				return id;
			},

			async checkpoint(runId: string, journal: RunJournal): Promise<boolean> {
				return (
					affectedRows(
						db
							.update(runs)
							.set(RunJournal.parse(journal))
							.where(ownRun(runId))
							.returning({ id: runs.id }),
					) > 0
				);
			},

			/**
			 * Writes the final state and, in the same transaction, deletes the applet's finished runs
			 * beyond the newest {@link RUNS_KEPT_PER_APPLET}. A `running` run is never counted or deleted.
			 */
			async finish(
				runId: string,
				status: FinishedRunStatus,
				journal: RunJournal,
			): Promise<boolean> {
				const values = { ...RunJournal.parse(journal), status, finishedAt: Date.now() };
				return db.transaction((tx) => {
					const run = tx.update(runs).set(values).where(ownRun(runId)).returning().get();
					if (!run) return false;
					const finishedOfApplet = and(eq(runs.appletId, run.appletId), ne(runs.status, "running"));
					const newest = tx
						.select({ id: runs.id })
						.from(runs)
						.where(finishedOfApplet)
						.orderBy(desc(runs.startedAt), desc(runs.id))
						.limit(RUNS_KEPT_PER_APPLET);
					tx.delete(runs)
						.where(and(finishedOfApplet, notInArray(runs.id, newest)))
						.run();
					return true;
				});
			},

			async get(runId: string): Promise<Run | undefined> {
				const row = db.select().from(runs).where(ownRun(runId)).get();
				return row && Run.parse(row);
			},

			/** Newest first, without the journal. */
			async listForApplet(appletId: string): Promise<RunSummary[]> {
				const { log: _log, stages: _stages, results: _results, ...summary } = getTableColumns(runs);
				const rows = db
					.select(summary)
					.from(runs)
					.where(and(eq(runs.accountId, accountId), eq(runs.appletId, appletId)))
					.orderBy(desc(runs.startedAt), desc(runs.id))
					.all();
				return rows.map((row) => RunSummary.parse(row));
			},
		},

		/** Grants are encrypted at rest; callers only ever see the plain document (ADR-0009 §6). */
		credentials: {
			async get(
				service: string,
			): Promise<{ document: JsonObject; expiresAt: number | null } | undefined> {
				const row = db.select().from(credentials).where(ownCredential(service)).get();
				if (!row) return undefined;
				const document = await decryptCredential(connection.encryptionKey, service, row.secret);
				return { document, expiresAt: row.expiresAt };
			},

			async put(service: string, document: JsonObject, expiresAt: number | null): Promise<void> {
				const secret = await encryptCredential(
					connection.encryptionKey,
					JsonObject.parse(document),
				);
				const columns = { expiresAt, keyVersion: CURRENT_KEY_VERSION, secret };
				db.insert(credentials)
					.values({ accountId, service, ...columns })
					.onConflictDoUpdate({
						target: [credentials.accountId, credentials.service],
						set: columns,
					})
					.run();
			},

			async remove(service: string): Promise<boolean> {
				const removed = db
					.delete(credentials)
					.where(ownCredential(service))
					.returning({ service: credentials.service });
				return affectedRows(removed) > 0;
			},
		},

		pluginSettings: {
			async get(plugin: string): Promise<JsonValue | undefined> {
				return db
					.select({ value: pluginSettings.value })
					.from(pluginSettings)
					.where(ownPluginSettings(plugin))
					.get()?.value;
			},

			async put(plugin: string, value: JsonValue): Promise<void> {
				const parsed = JsonValue.parse(value);
				db.insert(pluginSettings)
					.values({ accountId, plugin, value: parsed })
					.onConflictDoUpdate({
						target: [pluginSettings.accountId, pluginSettings.plugin],
						set: { value: parsed },
					})
					.run();
			},

			async remove(plugin: string): Promise<boolean> {
				const removed = db
					.delete(pluginSettings)
					.where(ownPluginSettings(plugin))
					.returning({ plugin: pluginSettings.plugin });
				return affectedRows(removed) > 0;
			},
		},
	};
}
