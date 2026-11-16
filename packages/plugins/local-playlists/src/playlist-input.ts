import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import {
	fromFileUri,
	type Log,
	nameFilter,
	type PlaylistInput,
	type SongDictInput,
} from "@ultrasonics/plugin-sdk";
import type { InputSettings } from "./input-settings.ts";
import { isAbsolutePath, type PathMapping, toLocalPath } from "./path-mapping.ts";
import { readSong, stemOf } from "./tags.ts";

const playlistExtensions = new Set([".m3u", ".m3u8"]);

/** A playlist file's lines, from UTF-8, or from Windows-1252 for an `.m3u` that isn't UTF-8. */
function decode(bytes: Uint8Array, path: string): string[] {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		const legacy = extname(path).toLowerCase() === ".m3u";
		text = new TextDecoder(legacy ? "windows-1252" : "utf-8").decode(bytes);
	}
	return text.split(/\r\n|\r|\n/);
}

/** Every playlist file under `dir`, skipping hidden names and never following a symlinked folder. */
async function listPlaylists(dir: string, recursive: boolean, log: Log): Promise<string[]> {
	const found: string[] = [];
	const visit = async (folder: string, entries: Dirent[]) => {
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const path = join(folder, entry.name);
			if (entry.isDirectory()) {
				if (!recursive) continue;
				try {
					await visit(path, await readdir(path, { withFileTypes: true }));
				} catch (error) {
					log.warn(`Skipped the folder ${path}, which couldn't be read: ${errorText(error)}`);
				}
			} else if (playlistExtensions.has(extname(entry.name).toLowerCase())) {
				found.push(relative(dir, path));
			}
		}
	};
	let top: Dirent[];
	try {
		top = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") throw new Error(`The playlists folder ${dir} doesn't exist.`);
		if (code === "ENOTDIR") throw new Error(`The playlists folder ${dir} isn't a folder.`);
		throw new Error(`Couldn't read the playlists folder ${dir}: ${errorText(error)}`);
	}
	await visit(dir, top);
	return found.sort().map((path) => join(dir, path));
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Added to a playlist's summary when none of its files were found. */
export const mappingHint =
	"None of its files were found: check the path mapping in this plugin's settings.";

interface Skipped {
	missing: string[];
	web: number;
}

/** The local path an entry names, or `undefined` for a web stream. */
function entryPath(entry: string, playlist: string, mapping: PathMapping): string | undefined {
	if (/^https?:\/\//i.test(entry)) return undefined;
	const named = entry.toLowerCase().startsWith("file:") ? fromFileUri(entry) : entry;
	if (named === undefined) return entry;
	// Players on Windows write relative entries with backslashes, which POSIX reads as part of a name.
	const absolute = isAbsolutePath(named)
		? named
		: resolve(dirname(playlist), sep === "/" ? named.replaceAll("\\", "/") : named);
	return toLocalPath(absolute, mapping);
}

function summarise(name: string, skipped: Skipped, songs: number): string | undefined {
	const parts = [];
	if (skipped.missing.length > 0) {
		parts.push(`${skipped.missing.length} missing (such as ${skipped.missing[0]})`);
	}
	if (skipped.web > 0) parts.push(`${skipped.web} web address${skipped.web === 1 ? "" : "es"}`);
	if (parts.length === 0) return undefined;
	const summary = `Playlist "${name}" skipped ${parts.join(" and ")}.`;
	return songs === 0 && skipped.missing.length > 0 ? `${summary} ${mappingHint}` : summary;
}

/** Reads every playlist file in the chosen folder (spec #178, "Reading"). */
export async function readPlaylists(
	settings: InputSettings,
	mapping: PathMapping,
	log: Log,
): Promise<SongDictInput> {
	let files = await listPlaylists(settings.dir, settings.recursive, log);
	const filter = settings.filter?.trim();
	if (filter) {
		const matches = nameFilter(filter);
		files = files.filter((file) => matches(stemOf(file)));
		if (files.length === 0)
			log.warn(`The filter "${filter}" matched no playlist in ${settings.dir}.`);
	}

	const playlists = [];
	for (const file of files) {
		const playlist = await readPlaylist(file, mapping, log);
		if (playlist) playlists.push(playlist);
	}
	return { version: 1, playlists };
}

/** One playlist file as a playlist, or `undefined` when the file can't be read. */
async function readPlaylist(
	file: string,
	mapping: PathMapping,
	log: Log,
): Promise<PlaylistInput | undefined> {
	let lines: string[];
	try {
		lines = decode(await readFile(file), file);
	} catch (error) {
		log.warn(`Skipped the playlist ${file}, which couldn't be read: ${errorText(error)}`);
		return undefined;
	}
	const name = stemOf(file);
	const skipped: Skipped = { missing: [], web: 0 };
	const songs = [];
	for (const line of lines) {
		const entry = line.trim();
		if (entry === "" || entry.startsWith("#")) continue;
		const path = entryPath(entry, file, mapping);
		if (path === undefined) skipped.web++;
		else if (!(await isFile(path))) skipped.missing.push(path);
		else songs.push(await readSong(path, log));
	}
	const summary = summarise(name, skipped, songs.length);
	if (summary) log.warn(summary);
	return { name, id: {}, songs };
}
