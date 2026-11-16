import { Schedule } from "@ultrasonics/db";
import { z } from "zod";

/** v1's `time trigger` took a month as 2,628,000 seconds. */
const DAYS_PER_V1_MONTH = 2_628_000 / 86_400;

const UNITS = {
	Hours: { unit: "hour", per: 1 },
	Days: { unit: "day", per: 1 },
	Weeks: { unit: "week", per: 1 },
	Months: { unit: "day", per: DAYS_PER_V1_MONTH },
} as const;

/** The per-instance data v1's `time trigger` 0.2 stored. */
const V1TimeTrigger = z.object({
	interval_input: z.string().trim().pipe(z.coerce.number<string>().nonnegative()),
	update_frequency: z.enum(["Hours", "Days", "Weeks", "Months"]),
	start_timestamp: z.string().trim().optional(),
});

const START = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/** `DD/MM/YYYY HH:MM`, as v1's `strptime` read it, to a local date-time. */
function anchorOf(start: string): string {
	const [, day, month, year, hour, minute] = START.exec(start) ?? [];
	if (!day) throw new Error("Its start time is not DD/MM/YYYY HH:MM.");
	return Temporal.PlainDateTime.from(
		{
			year: Number(year),
			month: Number(month),
			day: Number(day),
			hour: Number(hour),
			minute: Number(minute),
		},
		{ overflow: "reject" },
	).toString({ smallestUnit: "second" });
}

/**
 * A v1 time trigger as a v2 schedule (#177 decision 2): the nearest whole count, at least 1, with
 * months as days; anchored at its start, or at `now` when it had none. A note records any change.
 * Throws when the trigger's data is not v1's shape.
 */
export function scheduleFromTimeTrigger(
	data: unknown,
	at: { now: number; timeZone: string },
): { schedule: Schedule; notes: string[] } {
	const trigger = V1TimeTrigger.parse(data);
	const { unit, per } = UNITS[trigger.update_frequency];
	const count = Math.max(1, Math.round(trigger.interval_input * per));
	const anchor = trigger.start_timestamp
		? anchorOf(trigger.start_timestamp)
		: Temporal.Instant.fromEpochMilliseconds(at.now)
				.toZonedDateTimeISO(at.timeZone)
				.toPlainDateTime()
				.toString({ smallestUnit: "second" });

	const v1Unit = trigger.update_frequency.toLowerCase().replace(/s$/, "");
	const changed = trigger.update_frequency === "Months" || count !== trigger.interval_input;
	return {
		schedule: Schedule.parse({ kind: "interval", unit, count, anchor, timeZone: at.timeZone }),
		notes: changed
			? [`Every ${plural(trigger.interval_input, v1Unit)} became every ${plural(count, unit)}.`]
			: [],
	};
}
