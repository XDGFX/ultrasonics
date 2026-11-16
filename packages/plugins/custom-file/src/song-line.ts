import { fromFileUri, type Song } from "@ultrasonics/plugin-sdk";
import { renderTemplate, type TemplatePart } from "./template.ts";

/** The placeholders a line pattern may use, besides `{id.<space>}` (spec #180, "Rendering a line"). */
export const songPlaceholders = [
	"title",
	"artist",
	"artists",
	"album",
	"date",
	"isrc",
	"location",
] as const;

const ID_PREFIX = "id.";

/** Whether a line pattern may use this placeholder. */
export function isSongPlaceholder(name: string): boolean {
	return (
		(songPlaceholders as readonly string[]).includes(name) ||
		(name.startsWith(ID_PREFIX) && name.length > ID_PREFIX.length)
	);
}

/** One song is always one line. */
const oneLine = (value: string) => value.replace(/\r\n?|\n/g, " ");

function fieldOf(song: Song, placeholder: string): string | undefined {
	if (placeholder.startsWith(ID_PREFIX)) return song.id[placeholder.slice(ID_PREFIX.length)];
	switch (placeholder) {
		case "title":
			return song.title;
		case "artist":
			return song.artists[0];
		case "artists":
			return song.artists.length === 0 ? undefined : song.artists.join(", ");
		case "album":
			return song.album;
		case "date":
			return song.date;
		case "isrc":
			return song.isrc;
		case "location":
			return song.location === undefined
				? undefined
				: (fromFileUri(song.location) ?? song.location);
		default:
			return undefined;
	}
}

/** The song's line, or `undefined` when it lacks a field the pattern uses. */
export function songLine(pattern: TemplatePart[], song: Song): string | undefined {
	return renderTemplate(pattern, (placeholder) => {
		const value = fieldOf(song, placeholder);
		return value === undefined ? undefined : oneLine(value);
	});
}
