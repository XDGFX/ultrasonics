import type { Schedule } from "@ultrasonics/db";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The first slot on the schedule's grid strictly after `after`, in epoch milliseconds (ADR-0018 §1).
 * `day` and `week` step in calendar units in the schedule's zone, so a daily 03:00 stays at 03:00
 * across a clock change; `hour` steps in absolute hours from the anchor.
 */
export function nextSlot(schedule: Schedule, after: number): number {
	const anchor = Temporal.PlainDateTime.from(schedule.anchor);
	const first = instantOf(anchor, schedule.timeZone);
	if (first > after) return first;

	if (schedule.unit === "hour") {
		const step = schedule.count * HOUR_MS;
		return first + (Math.floor((after - first) / step) + 1) * step;
	}

	const days = schedule.count * (schedule.unit === "week" ? 7 : 1);
	// One step short of the estimate, since a clock change moves a slot by at most a few hours.
	let index = Math.max(0, Math.floor((after - first) / (days * DAY_MS)) - 1);
	for (; ; index++) {
		const slot = instantOf(anchor.add({ days: index * days }), schedule.timeZone);
		if (slot > after) return slot;
	}
}

/**
 * `nextSlot`, or `undefined` for a stored schedule with none: a count from before the route's bound
 * can step past the last date `Temporal` represents.
 */
export function nextSlotIfAny(schedule: Schedule, after: number): number | undefined {
	try {
		return nextSlot(schedule, after);
	} catch (error) {
		if (error instanceof RangeError) return undefined;
		throw error;
	}
}

/**
 * The instant a local date-time names in a zone. A time repeated by fall back is its first
 * occurrence; a time skipped by spring forward is the next valid instant, where the gap ends.
 */
function instantOf(local: Temporal.PlainDateTime, timeZone: string): number {
	const zoned = local.toZonedDateTime(timeZone, { disambiguation: "earlier" });
	if (zoned.toPlainDateTime().equals(local)) return zoned.epochMilliseconds;
	// In a gap, `earlier` reads the time with the old offset, which lands just before the gap.
	const gapEnd = zoned.getTimeZoneTransition("next");
	if (!gapEnd) throw new Error(`${local} in ${timeZone} is in a gap with no end`);
	return gapEnd.epochMilliseconds;
}
