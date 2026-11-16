import { fromFileUri, type Song } from "@ultrasonics/plugin-sdk";
import { renderTemplate, type TemplatePart } from "./template.ts";

/** Each placeholder a line pattern may use besides `{id.<space>}` (spec #180, "Rendering a line"). */
const fields: Record<string, (song: Song) => string | undefined> = {
	title: (song) => song.title,
	artist: (song) => song.artists[0],
	artists: (song) => (song.artists.length === 0 ? undefined : song.artists.join(", ")),
	album: (song) => song.album,
	date: (song) => song.date,
	isrc: (song) => song.isrc,
	location: (song) =>
		song.location === undefined ? undefined : (fromFileUri(song.location) ?? song.location),
};

const ID_PREFIX = "id.";

/** Every placeholder a line pattern may use, as the settings form lists them. */
export const songPlaceholderList = [...Object.keys(fields), `${ID_PREFIX}<service>`]
	.map((name) => `{${name}}`)
	.join(", ");

/** Whether a line pattern may use this placeholder. */
export function isSongPlaceholder(name: string): boolean {
	return (
		Object.hasOwn(fields, name) || (name.startsWith(ID_PREFIX) && name.length > ID_PREFIX.length)
	);
}

/** One song is always one line. */
const oneLine = (value: string) => value.replace(/\r\n?|\n/g, " ");

function fieldOf(song: Song, placeholder: string): string | undefined {
	if (placeholder.startsWith(ID_PREFIX)) return song.id[placeholder.slice(ID_PREFIX.length)];
	return fields[placeholder]?.(song);
}

/** The song's line, or `undefined` when it lacks a field the pattern uses. */
export function songLine(pattern: TemplatePart[], song: Song): string | undefined {
	return renderTemplate(pattern, (placeholder) => {
		const value = fieldOf(song, placeholder);
		return value === undefined ? undefined : oneLine(value);
	});
}
