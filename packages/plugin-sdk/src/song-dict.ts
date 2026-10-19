import { z } from "zod";

const text = z.string().trim().min(1);

/** Services send blanks routinely, so a blank optional field means absent (ADR-0023 §3). */
function optionalText<T extends z.ZodType<unknown, string>>(inner: T) {
	return z
		.string()
		.nullish()
		.transform((value) => value?.trim() || undefined)
		.pipe(inner.optional());
}

const durationMs = z
	.number()
	.int()
	.positive()
	.nullish()
	.transform((value) => value ?? undefined)
	.pipe(z.number().optional());

const explicit = z
	.boolean()
	.nullish()
	.transform((value) => value ?? undefined)
	.pipe(z.boolean().optional());

const partialIsoDate = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function isRealDate(value: string): boolean {
	const [, year, month = "01", day = "01"] = partialIsoDate.exec(value) ?? [];
	if (year === undefined) return false;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	return (
		date.getUTCFullYear() === Number(year) &&
		date.getUTCMonth() === Number(month) - 1 &&
		date.getUTCDate() === Number(day)
	);
}

/**
 * The release date of this release, as precise as the service knows it (ADR-0023 §5).
 * @package
 */
export const releaseDate = z.string().refine(isRealDate, "Expected YYYY, YYYY-MM or YYYY-MM-DD");

/** @package */
export const isrc = z
	.string()
	.regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/, "Expected a normalised 12-character ISRC");

function isFileUri(value: string): boolean {
	const url = URL.parse(value);
	return url?.protocol === "file:" && url.pathname !== "/";
}

/** A `file://` URI, so Windows and POSIX paths share one form (ADR-0023 §5, v1 #22). */
const fileUri = z.string().refine(isFileUri, "Expected an absolute file:// URI");

/**
 * Keys name an ID space, not a plugin; an ID unique to one server carries the server, as in
 * `plex:<server id>` (ADR-0023 §2).
 */
const idSpace = z.string().regex(/^[a-z0-9-]+(:\S+)?$/, "Expected an ID-space key");

/** A blank or null ID is dropped like any other blank (ADR-0023 §3); Last.fm sends empty MBIDs. */
const ids = z
	.record(z.string(), z.string().nullable())
	.nullish()
	.transform((value) =>
		Object.fromEntries(
			Object.entries(value ?? {}).flatMap(([space, id]) => {
				const trimmed = id?.trim();
				return trimmed ? [[space, trimmed] as const] : [];
			}),
		),
	)
	.pipe(z.record(idSpace, z.string()));

/** Zod keeps a key whose optional value parsed to `undefined`; absent means no key at all. */
function withoutAbsent<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

const songShape = z.object({
	title: text,
	artists: z.array(text),
	album: optionalText(z.string()),
	date: optionalText(releaseDate),
	isrc: optionalText(isrc),
	durationMs,
	explicit,
	location: optionalText(fileUri),
	id: ids,
});

export const Song = songShape.transform(withoutAbsent);

const playlistShape = z.object({
	name: text,
	description: optionalText(z.string()),
	id: ids,
	songs: z.array(Song),
});

export const Playlist = playlistShape.transform(withoutAbsent);

/** An object rather than a bare list, so run-wide fields can be added later (ADR-0023 §1). */
export const SongDict = z.object({
	version: z.literal(1).default(1),
	playlists: z.array(Playlist),
});

export type SongDict = z.output<typeof SongDict>;
export type SongDictInput = z.input<typeof SongDict>;
export type Playlist = z.output<typeof Playlist>;
export type PlaylistInput = z.input<typeof Playlist>;
export type Song = z.output<typeof Song>;
export type SongInput = z.input<typeof Song>;

/** Reports every value the lenient schema would silently repair: nulls and untrimmed strings. */
function reportRepairs(value: unknown, path: PropertyKey[], issues: z.core.$ZodRawIssue[]): void {
	if (value === null) {
		issues.push({
			code: "custom",
			message: "Expected a value or no key, not null",
			path,
			input: value,
		});
	} else if (typeof value === "string") {
		if (value.trim() !== value || value === "") {
			issues.push({
				code: "custom",
				message: "Expected a trimmed, non-blank string",
				path,
				input: value,
			});
		}
	} else if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) reportRepairs(item, [...path, index], issues);
	} else if (typeof value === "object") {
		for (const [key, item] of Object.entries(value)) reportRepairs(item, [...path, key], issues);
	}
}

const strictSong = songShape.strict().transform(withoutAbsent);
const strictPlaylist = playlistShape
	.extend({ songs: z.array(strictSong) })
	.strict()
	.transform(withoutAbsent);

/**
 * Rejects what `SongDict` repairs: blanks, untrimmed strings and unknown keys. The conformance
 * check fails on it, and the runner warns with it (ADR-0023 §6).
 */
export const StrictSongDict = z
	.unknown()
	.check((ctx) => reportRepairs(ctx.value, [], ctx.issues))
	.pipe(SongDict.extend({ playlists: z.array(strictPlaylist) }).strict());
