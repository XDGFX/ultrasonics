export const months = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

const pad = (value: number) => String(value).padStart(2, "0");

/** A time as "today 07:00", "yesterday 07:00", "tomorrow 07:00" or "01 nov 07:00", in local time. */
export function formatWhen(at: number, now: number = Date.now()): string {
	const date = new Date(at);
	const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	const day = (time: number) => new Date(time).setHours(0, 0, 0, 0);
	const offset = Math.round((day(at) - day(now)) / 86_400_000);
	const named = { [-1]: "yesterday", 0: "today", 1: "tomorrow" }[offset];
	return `${named ?? `${pad(date.getDate())} ${months[date.getMonth()]}`} ${clock}`;
}
