import { Song } from "./song-dict.ts";

/** Checking against `Song` itself keeps each helper's output inside the schema's rule. */
function passesSongRule(field: "isrc" | "date", value: string): string | undefined {
	const result = Song.safeParse({ title: "-", artists: [], [field]: value });
	return result.success ? result.data[field] : undefined;
}

/** Cleans a raw ISRC from a service, or gives `undefined` to leave the field out. */
export function normaliseIsrc(raw: string): string | undefined {
	return passesSongRule("isrc", raw.trim().toUpperCase().replace(/[- ]/g, ""));
}

const isoDateTime = /^(\d{4}-\d{2}-\d{2})T/;

/** Cleans a raw release date from a service, or gives `undefined` to leave the field out. */
export function normaliseDate(raw: string | number | Date): string | undefined {
	if (raw instanceof Date) {
		return Number.isNaN(raw.getTime()) ? undefined : normaliseDate(raw.toISOString());
	}
	const value = String(raw).trim();
	return passesSongRule("date", isoDateTime.exec(value)?.[1] ?? value);
}
