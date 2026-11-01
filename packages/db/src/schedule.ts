import { z } from "zod";

const isTimeZone = (zone: string) => {
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
};

export const IntervalSchedule = z.object({
	kind: z.literal("interval"),
	unit: z.enum(["hour", "day", "week"]),
	count: z.int().min(1),
	anchor: z.iso.datetime({ local: true }).refine((anchor) => !anchor.endsWith("Z"), {
		message: "The anchor is a local date-time, without a zone",
	}),
	timeZone: z.string().refine(isTimeZone, { message: "Not an IANA time zone" }),
});

export const Schedule = z.discriminatedUnion("kind", [IntervalSchedule]);
export type Schedule = z.infer<typeof Schedule>;
