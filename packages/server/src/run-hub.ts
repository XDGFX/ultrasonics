import {
	type FinishedRunStatus,
	type JournalColumns,
	type RunEvent,
	type RunEvents,
	toJournal,
} from "@ultrasonics/core";
import type { Logger } from "./logger.ts";

/** The least time between two checkpoints of one run's journal at stage finishes (ADR-0026 §4). */
export const CHECKPOINT_INTERVAL_MS = 5_000;

/** Where the hub writes one run's journal: its `runs` row. */
export interface JournalWriter {
	checkpoint(journal: JournalColumns): Promise<unknown>;
	/** Writes the final status and journal; the hub then forgets the run. */
	finish(status: FinishedRunStatus, journal: JournalColumns): Promise<unknown>;
}

/** The runner's sink for one live run, as the hub journals it. */
export interface JournalledRun extends RunEvents {
	/** Settles once the run's end is written to its row and the hub has dropped it. */
	readonly closed: Promise<void>;
	/** Ends a run the runner abandoned by throwing, as `failed`, one `seq` past its last event. */
	fail(): Promise<void>;
}

export type RunListener = (event: RunEvent) => void;

export interface RunHub {
	/** Starts journalling a run whose row exists. */
	open(runId: string, writer: JournalWriter): JournalledRun;
	/**
	 * Hands `listener` the live run's events after `afterSeq`, the held ones at once and then each as
	 * it comes, and returns the unsubscribe. `undefined` when the run isn't live: read its row.
	 */
	follow(runId: string, afterSeq: number, listener: RunListener): (() => void) | undefined;
	/**
	 * Ends every live run as `interrupted`, writing its journal, for a shutdown that cannot wait for
	 * them. Settles once each end is on its row; the runner's later events are dropped.
	 */
	interruptAll(): Promise<void>;
}

interface LiveRun {
	events: RunEvent[];
	listeners: Set<RunListener>;
	/** Emits `end` one `seq` past the last event, unless the run already ended; settles on `closed`. */
	end(status: FinishedRunStatus): Promise<void>;
}

/**
 * Holds each live run's events in memory, fans them out to its streams, and writes the journal to
 * the run's row at stage finishes and at `end` (ADR-0026 §3–4).
 */
export function createRunHub(deps: { logger: Logger; now?: () => number }): RunHub {
	const { logger } = deps;
	const now = deps.now ?? Date.now;
	const live = new Map<string, LiveRun>();

	return {
		open(runId, writer) {
			const run: LiveRun = {
				events: [],
				listeners: new Set(),
				end(status) {
					const last = run.events.at(-1);
					if (last?.type !== "end")
						emit({ type: "end", status, seq: (last?.seq ?? 0) + 1, at: now() });
					return closed;
				},
			};
			live.set(runId, run);
			let lastCheckpoint = Number.NEGATIVE_INFINITY;
			let writes = Promise.resolve();
			const { promise: closed, resolve: close } = Promise.withResolvers<void>();
			// One write at a time, in order, so a slow checkpoint never lands over the finish.
			const write = (what: string, perform: () => Promise<unknown>) => {
				writes = writes.then(perform).then(
					() => undefined,
					(error) => logger.error(`Writing run ${runId}'s ${what} failed`, error),
				);
				return writes;
			};

			const emit = (event: RunEvent) => {
				if (run.events.at(-1)?.type === "end") return;
				run.events.push(event);
				for (const listener of run.listeners) listener(event);
				if (event.type === "end") {
					const journal = toJournal(run.events);
					void write("end", () => writer.finish(event.status, journal)).then(() => {
						live.delete(runId);
						close();
					});
				} else if (
					event.type === "stage" &&
					event.state === "finished" &&
					now() - lastCheckpoint >= CHECKPOINT_INTERVAL_MS
				) {
					lastCheckpoint = now();
					const journal = toJournal(run.events);
					void write("checkpoint", () => writer.checkpoint(journal));
				}
			};

			return { emit, closed, fail: () => run.end("failed") };
		},

		async interruptAll() {
			await Promise.all([...live.values()].map((run) => run.end("interrupted")));
		},

		follow(runId, afterSeq, listener) {
			const run = live.get(runId);
			if (!run) return undefined;
			for (const event of run.events) if (event.seq > afterSeq) listener(event);
			run.listeners.add(listener);
			return () => run.listeners.delete(listener);
		},
	};
}
