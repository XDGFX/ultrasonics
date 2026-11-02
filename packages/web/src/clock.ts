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

/** A time of day as "07:00:02", in local time. */
export function formatClock(at: number): string {
	const date = new Date(at);
	return [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad).join(":");
}

/** A duration as "41 s", "2 m 5 s" or "1 h 3 m". */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds} s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)} m ${seconds % 60} s`;
	return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} m`;
}
