import { type EndEvent, RunEvent } from "@ultrasonics/core/run-events";

/** At once, as a finished run replays; stepped, released by the test; or one event per interval. */
export type RunPace = "at-once" | "stepped" | { intervalMs: number };

export interface RunScript {
	/** Parsed with core's `RunEvent`, so a script can't drift from what the runner emits. */
	events: unknown[];
	pace?: RunPace;
}

export interface ScriptedRun {
	/** Starts releasing events at the script's pace. */
	start(): void;
	/** Releases the next `count` events to every connection. */
	advance(count?: number): void;
	/** Closes every open connection, as a dropped network would; followers reconnect. */
	drop(): void;
	/** Replays from the first event, follows live, resumes after a drop, and ends after `end`. */
	follow(signal?: AbortSignal): AsyncIterable<RunEvent>;
	/** How many connections have been opened, counting reconnects. */
	readonly connections: number;
	/** How many connections are open now. */
	readonly open: number;
}

/** One scripted run's events; `startedAt` moves them to start then, as a run started now would. */
export function scriptedRun(
	script: RunScript,
	onEnd: (end: EndEvent) => void,
	startedAt?: number,
): ScriptedRun {
	const parsed = script.events.map((event) => RunEvent.parse(event));
	const shift = startedAt === undefined ? 0 : startedAt - (parsed[0]?.at ?? startedAt);
	const events = parsed.map((event) => ({ ...event, at: event.at + shift }));
	let released = 0;
	let connections = 0;
	let open = 0;
	let epoch = 0;
	const waiting = new Set<() => void>();

	const wake = () => {
		for (const resolve of waiting) resolve();
		waiting.clear();
	};

	const advance = (count = 1) => {
		const before = released;
		released = Math.min(events.length, released + count);
		const end = events.slice(before, released).find((event) => event.type === "end");
		if (end?.type === "end") onEnd(end);
		wake();
	};

	async function* connect(after: number, signal?: AbortSignal): AsyncGenerator<RunEvent> {
		connections++;
		open++;
		const opened = epoch;
		const closed = () => epoch !== opened || signal?.aborted === true;
		let cursor = after;
		try {
			for (;;) {
				for (const event of events.slice(0, released)) {
					if (event.seq <= cursor) continue;
					cursor = event.seq;
					yield structuredClone(event);
				}
				if (closed()) return;
				await new Promise<void>((resolve) => waiting.add(resolve));
				if (closed()) return;
			}
		} finally {
			open--;
		}
	}

	return {
		start() {
			const pace = script.pace ?? "at-once";
			if (pace === "at-once") advance(events.length);
			else if (pace !== "stepped") {
				const tick = () => {
					advance();
					if (released < events.length) setTimeout(tick, pace.intervalMs);
				};
				setTimeout(tick, pace.intervalMs);
			}
		},
		advance,
		drop() {
			epoch++;
			wake();
		},
		follow: (signal) => ({
			async *[Symbol.asyncIterator]() {
				signal?.addEventListener("abort", wake, { once: true });
				let after = 0;
				while (!signal?.aborted) {
					for await (const event of connect(after, signal)) {
						after = event.seq;
						yield event;
						if (event.type === "end") return;
					}
				}
			},
		}),
		get connections() {
			return connections;
		},
		get open() {
			return open;
		},
	};
}
