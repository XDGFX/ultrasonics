import { describe, expect, test } from "bun:test";
import { fixturePlugins } from "../test/fixture-plugins.ts";
import { fromJournal, LOG_CAP_BYTES, LOG_CAP_LINES, omittedLines, toJournal } from "./journal.ts";
import type { LogEvent, RunEvent } from "./run-event.ts";
import { runApplet } from "./runner.ts";

/** A run that emits every kind of event: logs, stages, a rejection, results and the end. */
async function runEvents(): Promise<RunEvent[]> {
	const events: RunEvent[] = [];
	const songs = [{ title: "a", artists: ["A"] }, { title: "" }];
	await runApplet({
		runId: "run-1",
		applet: {
			id: "applet-1",
			name: "Weekly sync",
			definition: {
				inputs: [{ plugin: "echo", settings: { returns: { playlists: [{ name: "P", songs }] } } }],
				modifiers: [],
				outputs: [
					{ plugin: "writer", settings: { unmatched: [0] } },
					{ plugin: "thrower", settings: {} },
				],
			},
		},
		trigger: "webhook",
		registry: fixturePlugins().registry,
		capabilities: {
			auth: {} as never,
			persistentSettings: async () => undefined,
			configDir: () => "/config",
		},
		events: { emit: (event) => events.push(event) },
	});
	return events;
}

const line = (seq: number, text = `line ${seq}`): LogEvent => ({
	type: "log",
	seq,
	at: seq,
	level: "info",
	source: "runner",
	text,
});

/** The stored columns as they come back from the database: JSON, not the objects written. */
const stored = (events: RunEvent[]) => JSON.parse(JSON.stringify(toJournal(events)));

describe("the journal", () => {
	test("round-trips a run's events unchanged through storage", async () => {
		const events = await runEvents();
		expect(new Set(events.map((event) => event.type))).toEqual(
			new Set(["log", "stage", "rejection", "result", "end"]),
		);

		expect(fromJournal(stored(events))).toEqual(events);
	});

	test("replays a run with no journal written yet as no events", () => {
		expect(fromJournal({ log: null, stages: null, results: null })).toEqual([]);
	});

	test("replays the columns a journal holds when the others are null or absent", async () => {
		const events = await runEvents();
		const { stages } = stored(events);

		expect(fromJournal({ log: null, stages })).toEqual(
			events.filter((event) => event.type === "stage" || event.type === "end"),
		);
	});

	test("over the line cap, keeps the head and the tail with an omitted-count line between", () => {
		const total = LOG_CAP_LINES + 500;
		const events = Array.from({ length: total }, (_, i) => line(i + 1));

		const log = fromJournal(stored(events)) as LogEvent[];

		expect(log.length).toBeLessThanOrEqual(LOG_CAP_LINES);
		expect(log[0]).toEqual(line(1));
		expect(log.at(-1)).toEqual(line(total));
		const markers = log.filter((event) => event.text === omittedLines(total - (log.length - 1)));
		expect(markers).toHaveLength(1);
		const marker = log.indexOf(markers[0] as LogEvent);
		expect(log[marker - 1]).toEqual(line(marker));
		expect(log[marker + 1]?.seq).toBe(total - (log.length - marker - 2));
	});

	test("over the byte cap, keeps the head and the tail within it", () => {
		const big = "x".repeat(LOG_CAP_BYTES / 8);
		const events = Array.from({ length: 20 }, (_, i) => line(i + 1, big));

		const log = fromJournal(stored(events)) as LogEvent[];

		const bytes = log.reduce((sum, event) => sum + event.text.length, 0);
		expect(bytes).toBeLessThanOrEqual(LOG_CAP_BYTES);
		expect(log[0]?.seq).toBe(1);
		expect(log.at(-1)?.seq).toBe(20);
		expect(log.some((event) => event.text === omittedLines(20 - (log.length - 1)))).toBe(true);
	});

	test("caps only the log, never stages or results", async () => {
		const events = await runEvents();
		const flood = Array.from({ length: LOG_CAP_LINES + 1 }, (_, i) => line(events.length + i + 1));

		const restored = fromJournal(stored([...events, ...flood]));

		expect(restored.filter((event) => event.type !== "log")).toEqual(
			events.filter((event) => event.type !== "log"),
		);
	});
});
