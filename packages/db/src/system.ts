import { and, eq, lte } from "drizzle-orm";
import { affectedRows } from "./affected-rows.ts";
import { connectionOf, type OpenDatabase } from "./connection.ts";
import { applets, runs, sessions } from "./schema.ts";

/** An applet named with the account that owns it, for the caller to pass to `storeFor`. */
interface OwnedApplet {
	accountId: string;
	appletId: string;
}

/**
 * The system module (ADR-0028): the cross-account queries for boot, the scheduler and the webhook
 * route. It returns only ids, flags and counts; callers then use `storeFor(accountId)`.
 * Lint allows this subpath only in those server files.
 */
export function systemModule(handle: OpenDatabase) {
	const { db } = connectionOf(handle);
	const ownedApplet = { accountId: applets.accountId, appletId: applets.id };
	return {
		/** Every enabled applet whose `next_run_at` has passed, across accounts (ADR-0018 §3). */
		async dueApplets(now: number): Promise<OwnedApplet[]> {
			return db
				.select(ownedApplet)
				.from(applets)
				.where(and(eq(applets.enabled, true), lte(applets.nextRunAt, now)))
				.all();
		},

		async appletForWebhookToken(
			hash: string,
		): Promise<(OwnedApplet & { enabled: boolean }) | undefined> {
			return db
				.select({ ...ownedApplet, enabled: applets.enabled })
				.from(applets)
				.where(eq(applets.webhookTokenHash, hash))
				.get();
		},

		/** Boot marks every `running` run `interrupted` (ADR-0018 §4); returns how many. */
		async interruptRunning(): Promise<number> {
			return affectedRows(
				db
					.update(runs)
					.set({ status: "interrupted" })
					.where(eq(runs.status, "running"))
					.returning({ id: runs.id }),
			);
		},

		async sweepExpiredSessions(now: number): Promise<number> {
			return affectedRows(
				db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id }),
			);
		},
	};
}

export type SystemModule = ReturnType<typeof systemModule>;
