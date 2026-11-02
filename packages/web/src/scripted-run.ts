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
	follow(): AsyncIterable<RunEvent>;
	/** How many connections have been opened, counting reconnects. */
	readonly connections: number;
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

	async function* connect(after: number): AsyncGenerator<RunEvent> {
		connections++;
		const opened = epoch;
		let cursor = after;
		for (;;) {
			for (const event of events.slice(0, released)) {
				if (event.seq <= cursor) continue;
				cursor = event.seq;
				yield structuredClone(event);
			}
			if (epoch !== opened) return;
			await new Promise<void>((resolve) => waiting.add(resolve));
			if (epoch !== opened) return;
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
		follow: () => ({
			async *[Symbol.asyncIterator]() {
				let after = 0;
				for (;;) {
					for await (const event of connect(after)) {
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
	};
}
