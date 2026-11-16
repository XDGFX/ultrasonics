import { randomUUID } from "node:crypto";
// The default export, so a test can make `rename` fail and show an interrupted write is harmless.
import fs from "node:fs/promises";
import { basename, join } from "node:path";
import {
	fromFileUri,
	type Log,
	type OutputResult,
	type Playlist,
	type PlaylistResult,
	type Song,
	type SongDict,
} from "@ultrasonics/plugin-sdk";
import { isFile } from "./files.ts";
import type { OutputSettings } from "./output-settings.ts";
import { type PathMapping, toPlayerPath } from "./path-mapping.ts";

/** What one output call needs from its run context. */
export interface OutputRun {
	songs: SongDict;
	instance: OutputSettings;
	persistent: PathMapping;
	log: Log;
	configDir: string;
	appletId: string;
}

/** Names Windows keeps for devices, whatever the extension (`CON.m3u8` is the console). */
const reservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A playlist name as a file stem that holds no separator, or `undefined` when nothing is left.
 * Leading dots go too, since a hidden file is one the input never reads.
 */
export function playlistStem(name: string): string | undefined {
	const stem = name
		.replace(/[\\/:*?"<>|\p{Cc}]/gu, "")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "");
	if (stem === "") return undefined;
	const device = stem.split(".")[0]?.trimEnd() ?? "";
	return reservedName.test(device) ? `_${stem}` : stem;
}

/** The path a song's `location` names, as the player sees it, or `undefined` when it has none. */
function playerPath(song: Song, mapping: PathMapping): string | undefined {
	const path = song.location === undefined ? undefined : fromFileUri(song.location);
	// A line break would split the entry in two.
	if (path === undefined || /[\r\n]/.test(path)) return undefined;
	return toPlayerPath(path, mapping);
}

function extinf(song: Song): string {
	const seconds = song.durationMs === undefined ? -1 : Math.round(song.durationMs / 1000);
	const label = song.artists.length > 0 ? `${song.artists.join(", ")} - ${song.title}` : song.title;
	return `#EXTINF:${seconds},${label.replace(/[\r\n]+/g, " ")}`;
}

function codeOf(error: unknown): string {
	const code = (error as NodeJS.ErrnoException).code;
	return code ?? (error instanceof Error ? error.message : String(error));
}

/** Throws unless `dir` is a folder, before any file is touched (ADR-0020 §3). */
async function checkFolder(dir: string): Promise<void> {
	let isFolder: boolean;
	try {
		isFolder = (await fs.stat(dir)).isDirectory();
	} catch (error) {
		if (codeOf(error) === "ENOENT") throw new Error(`The playlists folder ${dir} doesn't exist.`);
		throw new Error(`Couldn't open the playlists folder ${dir} (${codeOf(error)}).`);
	}
	if (!isFolder) throw new Error(`The playlists folder ${dir} isn't a folder.`);
}

/** Writes `text` beside `target` under a hidden name, then renames it over `target`. */
async function writeAtomically(dir: string, target: string, text: string): Promise<void> {
	const temporary = join(dir, `.ultrasonics-${randomUUID()}.tmp`);
	try {
		await fs.writeFile(temporary, text, { flag: "wx" });
		await fs.rename(temporary, target);
	} catch (error) {
		await fs.rm(temporary, { force: true });
		throw error;
	}
}

/** The run's backups: one timestamped folder per applet, made on the first copy. */
class Backups {
	private readonly folder: string;

	constructor(
		private readonly appletFolder: string,
		private readonly keep: number,
	) {
		this.folder = join(appletFolder, new Date().toISOString().replaceAll(":", "-"));
	}

	/** Copies `file`, the one about to be replaced, into this run's folder. */
	async copy(file: string): Promise<void> {
		if (this.keep === 0) return;
		await fs.mkdir(this.folder, { recursive: true });
		await fs.copyFile(file, join(this.folder, basename(file)));
	}

	/** Removes all but the newest `keep` runs' folders. */
	async prune(log: Log): Promise<void> {
		let runs: string[];
		try {
			runs = await fs.readdir(this.appletFolder);
		} catch {
			return;
		}
		try {
			for (const run of runs.sort().reverse().slice(this.keep)) {
				await fs.rm(join(this.appletFolder, run), { recursive: true, force: true });
			}
		} catch (error) {
			log.warn(`Couldn't remove old playlist backups in ${this.appletFolder} (${codeOf(error)}).`);
		}
	}
}

/** What every playlist in one output call shares. */
interface Writing {
	run: OutputRun;
	backups: Backups;
	/** Lower-cased, so names differing only in case never share a file where case doesn't count. */
	claimed: Set<string>;
}

const skipped = (playlist: number, code: string, message: string): PlaylistResult => ({
	status: "skipped",
	playlist,
	code,
	message,
});

const failed = (playlist: number, message: string): PlaylistResult => ({
	status: "failed",
	playlist,
	code: "write-error",
	message,
});

/** Writes every playlist it receives as a file in `dir` (spec #178, "Writing"). */
export async function writePlaylists(run: OutputRun): Promise<OutputResult> {
	await checkFolder(run.instance.dir);
	const writing: Writing = {
		run,
		backups: new Backups(
			join(run.configDir, "backups", run.appletId),
			Number(run.instance.backups),
		),
		claimed: new Set(),
	};

	const playlists: PlaylistResult[] = [];
	for (const [position, playlist] of run.songs.playlists.entries()) {
		try {
			playlists.push(await writePlaylist(playlist, position, writing));
		} catch (error) {
			playlists.push(
				failed(position, `Couldn't write playlist "${playlist.name}" (${codeOf(error)}).`),
			);
		}
	}
	await writing.backups.prune(run.log);
	return { playlists };
}

async function writePlaylist(
	playlist: Playlist,
	position: number,
	{ run, backups, claimed }: Writing,
): Promise<PlaylistResult> {
	const { name } = playlist;
	if (playlist.songs.length === 0)
		return skipped(position, "empty", `Playlist "${name}" has no songs.`);

	const stem = playlistStem(name);
	if (stem === undefined) {
		return skipped(
			position,
			"invalid-name",
			`Playlist "${name}" has no characters a file name can hold.`,
		);
	}
	const key = stem.normalize("NFC").toLowerCase();
	if (claimed.has(key)) {
		return skipped(
			position,
			"duplicate-name",
			`Playlist "${name}" would replace the file another playlist in this run wrote, ${stem}.`,
		);
	}
	claimed.add(key);

	const lines = ["#EXTM3U"];
	const unmatched: number[] = [];
	for (const [index, song] of playlist.songs.entries()) {
		const path = playerPath(song, run.persistent);
		if (path === undefined) unmatched.push(index);
		else lines.push(extinf(song), path);
	}
	if (unmatched.length === playlist.songs.length) {
		run.log.warn(`Playlist "${name}" has no song with a file, so it wasn't written.`);
		return skipped(position, "no-locations", `Playlist "${name}" has no song with a file.`);
	}

	const legacy = join(run.instance.dir, `${stem}.m3u`);
	const target = (await isFile(legacy)) ? legacy : join(run.instance.dir, `${stem}.m3u8`);
	try {
		if (await isFile(target)) await backups.copy(target);
		await writeAtomically(run.instance.dir, target, `${lines.join("\n")}\n`);
	} catch (error) {
		return failed(position, `Couldn't write playlist "${name}" to ${target} (${codeOf(error)}).`);
	}
	return { status: "written", playlist: position, unmatched };
}
