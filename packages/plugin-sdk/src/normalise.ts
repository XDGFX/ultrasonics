import { isrc, releaseDate } from "./song-dict.ts";

/** Cleans a raw ISRC from a service, or gives `undefined` to leave the field out. */
export function normaliseIsrc(raw: string): string | undefined {
	return isrc.safeParse(raw.trim().toUpperCase().replace(/[- ]/g, "")).data;
}

/** A full ISO 8601 date-time: a time, an optional fraction, and an optional `Z` or offset. */
const isoDateTime = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

/** Cleans a raw release date from a service, or gives `undefined` to leave the field out. */
export function normaliseDate(raw: string | number | Date): string | undefined {
	if (raw instanceof Date) {
		return Number.isNaN(raw.getTime()) ? undefined : normaliseDate(raw.toISOString());
	}
	const value = String(raw).trim();
	return releaseDate.safeParse(isoDateTime.exec(value)?.[1] ?? value).data;
}
