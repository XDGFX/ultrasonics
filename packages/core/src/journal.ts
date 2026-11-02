import { z } from "zod";
import {
	EndEvent,
	LogEvent,
	RejectionEvent,
	ResultEvent,
	type RunEvent,
	StageEvent,
} from "./run-event.ts";

/** A stored run's log is capped at whichever of these it reaches first (ADR-0009 §5). */
export const LOG_CAP_LINES = 10_000;
export const LOG_CAP_BYTES = 1024 * 1024;

/** The text of the line standing in for the log lines the cap dropped. */
export const omittedLines = (count: number) => `${count} lines omitted`;

/**
 * A run's events as the `runs` row stores them (ADR-0026 §4): log lines in `log`; stages and the
 * end in `stages`; output results and rejections in `results` (ADR-0020 §6, ADR-0021 §5).
 */
export const JournalColumns = z.object({
	log: z.array(LogEvent),
	stages: z.array(z.union([StageEvent, EndEvent])),
	results: z.array(z.union([ResultEvent, RejectionEvent])),
});
export type JournalColumns = z.infer<typeof JournalColumns>;

const encoder = new TextEncoder();

/** Keeps the head, which says what ran, and the tail, which says how it ended (ADR-0009 §5). */
function capLog(lines: LogEvent[]): LogEvent[] {
	const sizes = lines.map((line) => encoder.encode(line.text).length);
	const total = sizes.reduce((sum, size) => sum + size, 0);
	if (lines.length <= LOG_CAP_LINES && total <= LOG_CAP_BYTES) return lines;

	// Half the budget each side, less room for the marker line.
	const keepLines = Math.floor((LOG_CAP_LINES - 1) / 2);
	const keepBytes = (LOG_CAP_BYTES - 64) / 2;
	const keep = (positions: (i: number) => number, limit: number) => {
		let kept = 0;
		let bytes = 0;
		while (kept < limit && kept < keepLines) {
			const size = sizes[positions(kept)] ?? 0;
			if (bytes + size > keepBytes) break;
			bytes += size;
			kept++;
		}
		return kept;
	};
	const head = keep((i) => i, lines.length);
	const tail = keep((i) => lines.length - 1 - i, lines.length - head);
	const firstOmitted = lines[head] as LogEvent;
	const marker: LogEvent = {
		...firstOmitted,
		level: "warn",
		source: "runner",
		text: omittedLines(lines.length - head - tail),
	};
	return [...lines.slice(0, head), marker, ...lines.slice(lines.length - tail)];
}

/** The `log`, `stages` and `results` column values for a run's events, with the log capped. */
export function toJournal(events: RunEvent[]): JournalColumns {
	const columns: JournalColumns = { log: [], stages: [], results: [] };
	for (const event of events) {
		if (event.type === "log") columns.log.push(event);
		else if (event.type === "stage" || event.type === "end") columns.stages.push(event);
		else columns.results.push(event);
	}
	return { ...columns, log: capLog(columns.log) };
}

/** A column stays null until the run's first checkpoint writes it, so null reads as no events. */
const storedColumn = <T>(column: z.ZodType<T[]>) =>
	column.nullish().transform((events) => events ?? []);

const StoredJournal = z.object({
	log: storedColumn(JournalColumns.shape.log),
	stages: storedColumn(JournalColumns.shape.stages),
	results: storedColumn(JournalColumns.shape.results),
});

/** A stored run's events, in order, so a finished run replays through the live code path. */
export function fromJournal(journal: unknown): RunEvent[] {
	const { log, stages, results } = StoredJournal.parse(journal);
	return [...log, ...stages, ...results].sort((a, b) => a.seq - b.seq);
}
