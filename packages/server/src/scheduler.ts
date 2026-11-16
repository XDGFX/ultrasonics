import type { OpenDatabase } from "@ultrasonics/db";
import { systemModule } from "@ultrasonics/db/system";
import { z } from "zod";
import type { Logger } from "./logger.ts";
import { nextSlotIfAny } from "./next-slot.ts";
import type { RunStarter } from "./run-starter.ts";

/** ADR-0018 §3: one loop, a 60-second tick. */
export const TICK_INTERVAL_MS = 60_000;

/** Whether reading an applet failed on its stored schedule, rather than on anything else. */
const isUnreadableSchedule = (error: unknown) =>
	error instanceof z.ZodError && error.issues.some((issue) => issue.path[0] === "schedule");

export interface Scheduler {
	/** Fires every due applet once and sweeps expired sessions. Logs a failure; never rejects. */
	tick(): Promise<void>;
	/** Ticks now, then again a full interval after each tick finishes, so ticks never overlap. */
	start(): void;
	/** Stops the loop, waiting for a tick in progress. */
	stop(): Promise<void>;
}

export function createScheduler(deps: {
	db: OpenDatabase;
	runs: RunStarter;
	now: () => number;
	logger: Logger;
}): Scheduler {
	const { db, runs, now, logger } = deps;
	const system = systemModule(db);

	async function fire(accountId: string, appletId: string, at: number): Promise<void> {
		const store = db.storeFor(accountId);
		// A stored schedule the scheduler can't step would fail every tick, so it is removed, once.
		const unschedule = async (why: string, error?: unknown) => {
			await store.applets.setSchedule(appletId, null);
			logger.error(`Removed the schedule of applet ${appletId}: ${why}`, error);
		};
		let applet: Awaited<ReturnType<typeof store.applets.get>>;
		try {
			applet = await store.applets.get(appletId);
		} catch (error) {
			if (!isUnreadableSchedule(error)) throw error;
			return unschedule("it could not be read", error);
		}
		if (!applet?.schedule) return;
		// Advancing from now, not the missed slot, collapses a backlog into one run (ADR-0018 §4).
		const next = nextSlotIfAny(applet.schedule, at);
		if (next === undefined) return unschedule("it has no next slot");
		await store.applets.setNextRunAt(appletId, next);
		await runs.submit(accountId, appletId, "schedule");
	}

	async function tick(): Promise<void> {
		try {
			const at = now();
			for (const { accountId, appletId } of await system.dueApplets(at)) {
				try {
					await fire(accountId, appletId, at);
				} catch (error) {
					logger.error(`The scheduled run of applet ${appletId} failed to start`, error);
				}
			}
			await system.sweepExpiredSessions(at);
		} catch (error) {
			logger.error("A scheduler tick failed; the next one will try again", error);
		}
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	let running: Promise<void> | undefined;
	let stopped = false;

	function loop(): void {
		running = tick().then(() => {
			if (!stopped) timer = setTimeout(loop, TICK_INTERVAL_MS);
		});
	}

	return {
		tick,
		start() {
			stopped = false;
			loop();
		},
		async stop() {
			stopped = true;
			clearTimeout(timer);
			await running;
		},
	};
}
