import { issuesOf, toFormSchema, withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import type { SaveResult, Schedule } from "./api-client.ts";
import { pad } from "./clock.ts";

const fields = z.object({
	unit: withMeta(z.enum(["hour", "day", "week"]).default("day"), { title: "every" }),
	count: withMeta(z.int().min(1).default(1), {
		title: "how many",
		description: "every 2 weeks is a count of 2",
	}),
	date: withMeta(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), {
		title: "from",
		placeholder: "2026-11-01",
	}),
	time: withMeta(z.string().regex(/^\d{2}:\d{2}$/), { title: "at", placeholder: "07:00" }),
});

const converted = toFormSchema(fields);
if (!converted.ok) throw new Error("The schedule form is not renderable");
export const scheduleForm = converted.jsonSchema;

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A new schedule: every day at 07:00 from today. */
export function newSchedule(now = new Date()): Schedule {
	const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	return {
		kind: "interval",
		unit: "day",
		count: 1,
		anchor: `${today}T07:00:00`,
		timeZone: browserTimeZone(),
	};
}

export function scheduleFormValue({ unit, count, anchor }: Schedule) {
	const [date = "", time = ""] = anchor.split("T");
	return { unit, count, date, time: time.slice(0, 5) };
}

/** The schedule a form value describes, in the browser's zone (ADR-0018 §1), or why it can't be one. */
export function scheduleOf(value: unknown): SaveResult<Schedule> {
	const parsed = fields.safeParse(value);
	if (!parsed.success) {
		return { ok: false, issues: issuesOf(parsed.error) };
	}
	const { unit, count, date, time } = parsed.data;
	return {
		ok: true,
		value: {
			kind: "interval",
			unit,
			count,
			anchor: `${date}T${time}:00`,
			timeZone: browserTimeZone(),
		},
	};
}
