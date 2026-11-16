import { normaliseDate, normaliseIsrc, type SongInput } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A track or episode as a playlist entry or saved track carries it; every field may be missing. */
const Item = z.object({
	type: z.string().nullish(),
	id: z.string().nullish(),
	name: z.string().nullish(),
	artists: z.array(z.object({ name: z.string().nullish() })).nullish(),
	album: z.object({ name: z.string().nullish(), release_date: z.string().nullish() }).nullish(),
	duration_ms: z.number().nullish(),
	explicit: z.boolean().nullish(),
	external_ids: z.object({ isrc: z.string().nullish() }).nullish(),
});

/** A playlist entry, which holds its track as `item`, or a saved track, which holds it as `track`. */
export const Entry = z.object({
	is_local: z.boolean().nullish(),
	added_at: z.string().nullish(),
	item: Item.nullish(),
	track: Item.nullish(),
});
export type Entry = z.output<typeof Entry>;

/** What one playlist's odd items came to, for its single summary warning. */
export interface Tally {
	removed: number;
	episodes: number;
	untitled: number;
	local: number;
}

export const emptyTally = (): Tally => ({ removed: 0, episodes: 0, untitled: 0, local: 0 });

const blankToAbsent = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

/**
 * One entry as a song, or `undefined` when it can't be one (spec #136, "Odd items"). Blank optional
 * fields are left out rather than sent empty (ADR-0023).
 */
export function songOf(raw: unknown, tally: Tally): SongInput | undefined {
	const parsed = Entry.safeParse(raw);
	const entry = parsed.success ? parsed.data : undefined;
	const item = entry?.item ?? entry?.track;
	if (!item) {
		tally.removed += 1;
		return undefined;
	}
	if (item.type !== undefined && item.type !== null && item.type !== "track") {
		tally.episodes += 1;
		return undefined;
	}
	const title = blankToAbsent(item.name);
	if (title === undefined) {
		tally.untitled += 1;
		return undefined;
	}
	const local = entry?.is_local === true;
	if (local) tally.local += 1;
	const song: SongInput = {
		title,
		artists: (item.artists ?? []).flatMap((artist) => blankToAbsent(artist.name) ?? []),
	};
	const album = blankToAbsent(item.album?.name);
	if (album !== undefined) song.album = album;
	const releaseDate = blankToAbsent(item.album?.release_date);
	const date = releaseDate === undefined ? undefined : normaliseDate(releaseDate);
	if (date !== undefined) song.date = date;
	const rawIsrc = blankToAbsent(item.external_ids?.isrc);
	const isrc = rawIsrc === undefined ? undefined : normaliseIsrc(rawIsrc);
	if (isrc !== undefined) song.isrc = isrc;
	if (
		typeof item.duration_ms === "number" &&
		Number.isInteger(item.duration_ms) &&
		item.duration_ms > 0
	) {
		song.durationMs = item.duration_ms;
	}
	if (typeof item.explicit === "boolean") song.explicit = item.explicit;
	const id = blankToAbsent(item.id);
	if (id !== undefined && !local) song.id = { spotify: id };
	return song;
}

export const plural = (count: number, one: string, many: string) =>
	`${count} ${count === 1 ? one : many}`;

/** The one warning a playlist's odd items earn, or `undefined` when it had none. */
export function tallyWarning(playlist: string, tally: Tally): string | undefined {
	const skipped = [
		tally.removed && `${tally.removed} removed or unavailable`,
		tally.episodes && plural(tally.episodes, "episode", "episodes"),
		tally.untitled && `${tally.untitled} without a title`,
	].filter(Boolean);
	const skippedCount = tally.removed + tally.episodes + tally.untitled;
	const parts: string[] = [];
	if (skippedCount > 0) {
		parts.push(`skipped ${plural(skippedCount, "item", "items")} (${skipped.join(", ")})`);
	}
	if (tally.local > 0) {
		parts.push(`carried ${plural(tally.local, "local file", "local files")} without a Spotify id`);
	}
	return parts.length === 0 ? undefined : `In "${playlist}", ${parts.join(" and ")}`;
}

const namedEntities: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** Spotify sends playlist descriptions HTML-escaped (`&#x27;`, `&amp;`). */
export function unescapeHtml(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
		if (entity[0] === "#") {
			const code =
				entity[1] === "x" || entity[1] === "X"
					? Number.parseInt(entity.slice(2), 16)
					: Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
		}
		return namedEntities[entity.toLowerCase()] ?? whole;
	});
}
