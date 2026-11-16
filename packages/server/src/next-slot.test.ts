import { describe, expect, test } from "bun:test";
import type { Schedule } from "@ultrasonics/db";
import { nextSlot } from "./next-slot.ts";

const at = (iso: string) => Date.parse(iso);

function every(
	count: number,
	unit: Schedule["unit"],
	anchor: string,
	timeZone = "Europe/London",
): Schedule {
	return { kind: "interval", unit, count, anchor, timeZone };
}

describe("nextSlot", () => {
	test("an hourly schedule steps in absolute hours across a clock change", () => {
		// London springs forward at 01:00 GMT on 29 March 2026; 00:00 GMT is 00:00 local.
		const hourly = every(1, "hour", "2026-03-29T00:00");
		expect(nextSlot(hourly, at("2026-03-29T00:30Z"))).toBe(at("2026-03-29T01:00Z"));
		expect(nextSlot(hourly, at("2026-03-29T01:00Z"))).toBe(at("2026-03-29T02:00Z"));
	});

	test("a daily schedule keeps its wall-clock time across spring forward and fall back", () => {
		const daily = every(1, "day", "2026-03-01T03:00");
		// 03:00 GMT the day before the change, 03:00 BST (02:00Z) the day after.
		expect(nextSlot(daily, at("2026-03-28T12:00Z"))).toBe(at("2026-03-29T02:00Z"));
		// London falls back on 25 October 2026: 03:00 BST, then 03:00 GMT.
		expect(nextSlot(daily, at("2026-10-24T12:00Z"))).toBe(at("2026-10-25T03:00Z"));
		expect(nextSlot(daily, at("2026-10-23T12:00Z"))).toBe(at("2026-10-24T02:00Z"));
	});

	test("a slot in the spring-forward gap runs at the next valid instant", () => {
		// New York skips 02:00–03:00 on 8 March 2026; 03:00 EDT is 07:00Z.
		const daily = every(1, "day", "2026-03-01T02:30", "America/New_York");
		expect(nextSlot(daily, at("2026-03-07T12:00Z"))).toBe(at("2026-03-08T07:00Z"));
		// The day after, it is back at 02:30 EDT.
		expect(nextSlot(daily, at("2026-03-08T12:00Z"))).toBe(at("2026-03-09T06:30Z"));
	});

	test("a slot repeated by fall back runs once, at its first occurrence", () => {
		// New York repeats 01:00–02:00 on 1 November 2026: 01:30 EDT is 05:30Z, 01:30 EST 06:30Z.
		const daily = every(1, "day", "2026-10-01T01:30", "America/New_York");
		expect(nextSlot(daily, at("2026-11-01T00:00Z"))).toBe(at("2026-11-01T05:30Z"));
		expect(nextSlot(daily, at("2026-11-01T05:30Z"))).toBe(at("2026-11-02T06:30Z"));
	});

	test("a weekly schedule steps in calendar weeks", () => {
		// Monday 2 March 2026, 09:00 GMT; the clocks change on Sunday 29 March.
		const weekly = every(1, "week", "2026-03-02T09:00");
		expect(nextSlot(weekly, at("2026-03-02T09:00Z"))).toBe(at("2026-03-09T09:00Z"));
		expect(nextSlot(weekly, at("2026-03-27T00:00Z"))).toBe(at("2026-03-30T08:00Z"));
	});

	test("a count above one steps that many units from the anchor", () => {
		const everyThreeDays = every(3, "day", "2026-01-01T06:00", "UTC");
		expect(nextSlot(everyThreeDays, at("2026-01-02T00:00Z"))).toBe(at("2026-01-04T06:00Z"));
		const everySixHours = every(6, "hour", "2026-01-01T06:00", "UTC");
		expect(nextSlot(everySixHours, at("2026-01-03T13:00Z"))).toBe(at("2026-01-03T18:00Z"));
	});

	test("an anchor in the future is the first slot", () => {
		const daily = every(1, "day", "2027-01-01T08:00", "UTC");
		expect(nextSlot(daily, at("2026-06-01T00:00Z"))).toBe(at("2027-01-01T08:00Z"));
	});

	test("a slot exactly at `after` is not next: the next is strictly after it", () => {
		const daily = every(1, "day", "2026-01-01T08:00", "UTC");
		expect(nextSlot(daily, at("2026-01-01T08:00Z"))).toBe(at("2026-01-02T08:00Z"));
		expect(nextSlot(daily, at("2026-01-01T07:59:59.999Z"))).toBe(at("2026-01-01T08:00Z"));
	});
});
