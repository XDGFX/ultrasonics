import type { RunTrigger } from "@ultrasonics/db";

export type QueueState = "idle" | "running" | "queued";

/** Starts one run; the queue waits for it to settle, whether it resolves or rejects. */
export type StartRun = (trigger: RunTrigger) => Promise<unknown>;

export interface RunQueue {
	/** Starts the run now, or queues it behind the applet's current run. */
	submit(appletId: string, trigger: RunTrigger, start: StartRun): "started" | "queued";
	state(appletId: string): QueueState;
}

/**
 * Serialises runs of one applet at a queue depth of one; different applets run at once
 * (ADR-0011 §4–5). In memory only: a crash loses a pending run (ADR-0018 §4).
 */
export function createRunQueue(): RunQueue {
	/** Applets with a run in flight, and the first trigger absorbed behind it, if any. */
	const running = new Map<string, { trigger: RunTrigger; start: StartRun } | undefined>();

	function begin(appletId: string, trigger: RunTrigger, start: StartRun): void {
		running.set(appletId, undefined);
		const next = () => {
			const pending = running.get(appletId);
			if (pending) begin(appletId, pending.trigger, pending.start);
			else running.delete(appletId);
		};
		new Promise((resolve) => resolve(start(trigger))).then(next, next);
	}

	return {
		submit(appletId, trigger, start) {
			if (!running.has(appletId)) {
				begin(appletId, trigger, start);
				return "started";
			}
			if (running.get(appletId) === undefined) running.set(appletId, { trigger, start });
			return "queued";
		},
		state(appletId) {
			if (!running.has(appletId)) return "idle";
			return running.get(appletId) === undefined ? "running" : "queued";
		},
	};
}
