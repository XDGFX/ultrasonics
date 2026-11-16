import { constants, type Dirent } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { readSong } from "@ultrasonics/plugin-local-playlists/tags";
import type { Log, SongInput } from "@ultrasonics/plugin-sdk";
import type { FileStamp, IndexedFile, LibraryIndex } from "./library-index.ts";
import { MUSIC_FOLDER } from "./music-folder.ts";

/** Extensions the tag reader understands, lowercase. Anything else in the folder is ignored. */
const AUDIO_EXTENSIONS = new Set([
	".aac",
	".aif",
	".aiff",
	".ape",
	".dsf",
	".flac",
	".m4a",
	".mp3",
	".mp4",
	".mpc",
	".oga",
	".ogg",
	".opus",
	".wav",
	".wma",
	".wv",
]);

/** Files read between progress lines, so a long first scan doesn't look hung. */
const PROGRESS_EVERY = 1_000;

/** Rows written per transaction, so a concurrent run's writes interleave rather than wait. */
const WRITE_BATCH = 500;

/** Tag reads in flight at once. */
const READ_CONCURRENCY = 8;

/** What a scan did, as its summary line reports it. */
export interface ScanCounts {
	read: number;
	unchanged: number;
	removed: number;
	unreadable: number;
}

/** The audio files under `dir`, skipping hidden names and never following a symlinked folder. */
async function* audioFiles(dir: string, counts: ScanCounts, log: Log): AsyncGenerator<string> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		counts.unreadable += 1;
		log.debug(`Couldn't list the folder ${dir}: ${String(error)}`);
		return;
	}
	entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* audioFiles(path, counts, log);
		else if (AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) yield path;
	}
}

/** The file's stamp, following a symlink to its file; `"not a file"` for anything else. */
async function stampOf(path: string, log: Log): Promise<FileStamp | "not a file" | "unreadable"> {
	try {
		const info = await stat(path);
		if (!info.isFile()) return "not a file";
		await access(path, constants.R_OK);
		return { size: info.size, mtimeMs: info.mtimeMs };
	} catch (error) {
		log.debug(`Couldn't read ${path}, so it was skipped: ${String(error)}`);
		return "unreadable";
	}
}

/** The file's song, or `undefined` when its tags can't be parsed. */
async function songOf(path: string, log: Log): Promise<SongInput | undefined> {
	// `readSong` carries a file it can't parse under its stem, and says so only at `debug`.
	let parsed = true;
	const song = await readSong(path, {
		...log,
		debug: (message) => {
			parsed = false;
			log.debug(`${message} It was skipped.`);
		},
	});
	return parsed ? song : undefined;
}

/**
 * Brings the index up to date with `musicDir` (spec #179, "Scanning"): tags are read only for new
 * or changed files, by size and modification time, and files no longer there are dropped.
 */
export async function scanMusicFolder(
	index: LibraryIndex,
	musicDir: string,
	log: Log,
): Promise<ScanCounts> {
	const started = performance.now();
	const counts: ScanCounts = { read: 0, unchanged: 0, removed: 0, unreadable: 0 };
	const known = index.stamps();
	const unseen = new Set(known.keys());
	const changed: { path: string; stamp: FileStamp }[] = [];
	/** Files that are there but can't be parsed: kept out of the index, not counted as removed. */
	const unparsed: string[] = [];

	for await (const path of audioFiles(musicDir, counts, log)) {
		const stamp = await stampOf(path, log);
		if (stamp === "not a file") continue;
		if (stamp === "unreadable") {
			counts.unreadable += 1;
			continue;
		}
		unseen.delete(path);
		const before = known.get(path);
		if (before?.size === stamp.size && before.mtimeMs === stamp.mtimeMs) counts.unchanged += 1;
		else changed.push({ path, stamp });
	}

	if (changed.length >= PROGRESS_EVERY) {
		log.info(`Reading the tags of ${changed.length} new or changed files in the ${MUSIC_FOLDER}`);
	}
	let batch: IndexedFile[] = [];
	let next = 0;
	const readNext = async (): Promise<void> => {
		for (let item = changed[next++]; item !== undefined; item = changed[next++]) {
			const song = await songOf(item.path, log);
			if (song === undefined) {
				counts.unreadable += 1;
				unparsed.push(item.path);
				continue;
			}
			batch.push({ path: item.path, ...item.stamp, song });
			counts.read += 1;
			if (counts.read % PROGRESS_EVERY === 0) {
				log.info(`Read the tags of ${counts.read} of ${changed.length} files`);
			}
			if (batch.length >= WRITE_BATCH) {
				index.write(batch);
				batch = [];
			}
		}
	};
	await Promise.all(Array.from({ length: READ_CONCURRENCY }, readNext));
	index.write(batch);

	index.remove([...unseen, ...unparsed]);
	counts.removed = unseen.size;
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	log.info(
		`Scanned the ${MUSIC_FOLDER} in ${seconds} s: ${counts.read} read, ${counts.unchanged} unchanged, ${counts.removed} removed, ${counts.unreadable} unreadable`,
	);
	return counts;
}
