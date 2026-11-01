import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { JsonValue } from "./json.ts";
import { type RUN_STATUSES, type RUN_TRIGGERS, runs } from "./schema.ts";

export const RunJournal = z.object({ log: JsonValue, stages: JsonValue, results: JsonValue });
export type RunJournal = z.infer<typeof RunJournal>;

export const Run = createSelectSchema(runs, {
	log: JsonValue.nullable(),
	stages: JsonValue.nullable(),
	results: JsonValue.nullable(),
});
export type Run = z.infer<typeof Run>;

export const RunSummary = Run.omit({ log: true, stages: true, results: true });
export type RunSummary = z.infer<typeof RunSummary>;

export type RunTrigger = (typeof RUN_TRIGGERS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type FinishedRunStatus = Exclude<RunStatus, "running">;
