import { describe, expect, test } from "bun:test";
import { scheduleFromTimeTrigger } from "./time-trigger.ts";

// 2026-11-16 02:48:52 UTC, which is 13:48:52 in Sydney.
const now = Date.UTC(2026, 10, 16, 2, 48, 52, 300);
const at = { now, timeZone: "UTC" };

const trigger = (interval: string, unit: string, start = "01/03/2021 07:30") => ({
	interval_input: interval,
	update_frequency: unit,
	start_timestamp: start,
});

describe("scheduleFromTimeTrigger", () => {
	test.each([
		["Hours", "hour"],
		["Days", "day"],
		["Weeks", "week"],
	] as const)("keeps a whole number of %s in the same unit, without a note", (v1Unit, unit) => {
		expect(scheduleFromTimeTrigger(trigger("3", v1Unit), at)).toEqual({
			schedule: {
				kind: "interval",
				unit,
				count: 3,
				anchor: "2021-03-01T07:30:00",
				timeZone: "UTC",
			},
			notes: [],
		});
	});

	test.each([
		["1.5", 2],
		["2.4", 2],
		["0.2", 1],
		["0", 1],
	])("rounds %p hours to %p and notes it", (interval, count) => {
		const { schedule, notes } = scheduleFromTimeTrigger(trigger(interval, "Hours"), at);

		expect(schedule.count).toBe(count);
		expect(notes).toHaveLength(1);
	});

	test("turns months into days at v1's own month length, and notes it", () => {
		const { schedule, notes } = scheduleFromTimeTrigger(trigger("2", "Months"), at);

		expect(schedule).toMatchObject({ unit: "day", count: 61 });
		expect(notes).toHaveLength(1);
	});

	test("anchors a blank start at the import time, in the zone given", () => {
		const { schedule } = scheduleFromTimeTrigger(trigger("1", "Days", ""), {
			now,
			timeZone: "Australia/Sydney",
		});

		expect(schedule).toMatchObject({
			anchor: "2026-11-16T13:48:52",
			timeZone: "Australia/Sydney",
		});
	});

	test.each([
		["an interval that is not a number", trigger("ten", "Days")],
		["an unknown unit", trigger("1", "Years")],
		["a start that is not a date", trigger("1", "Days", "31/02/2021 07:30")],
		["a start in another format", trigger("1", "Days", "2021-03-01 07:30")],
	])("throws for %s", (_, data) => {
		expect(() => scheduleFromTimeTrigger(data, at)).toThrow();
	});
});
