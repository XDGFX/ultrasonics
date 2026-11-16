import { Database, SQLiteError } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Log, Song, type SongInput, toFileUri } from "@ultrasonics/plugin-sdk";

/** The index's file in the plugin's `configDir` (spec #179, "The index"). */
export const INDEX_FILE = "library.db";

/** Bumped whenever the tables change: the index is a cache, rebuilt rather than migrated. */
const SCHEMA_VERSION = "1";

/** Each candidate query's cap, so a common title can't flood the matcher. */
const CANDIDATE_LIMIT = 25;

/** How long a run waits for another run's write before failing (ADR-0011 §5). */
const BUSY_TIMEOUT_MS = 30_000;

const SCHEMA = `
	CREATE TABLE files (
		path TEXT PRIMARY KEY,
		size INTEGER NOT NULL,
		mtime_ms REAL NOT NULL,
		title TEXT NOT NULL,
		title_key TEXT NOT NULL,
		artists TEXT NOT NULL,
		album TEXT,
		date TEXT,
		isrc TEXT,
		duration_ms INTEGER,
		musicbrainz TEXT
	);
	CREATE INDEX files_isrc ON files (isrc);
	CREATE INDEX files_musicbrainz ON files (musicbrainz);
	CREATE INDEX files_title_key ON files (title_key);
`;

/** A file as the last scan saw it on disk. */
export interface FileStamp {
	size: number;
	mtimeMs: number;
}

export interface IndexedFile extends FileStamp {
	path: string;
	song: SongInput;
}

interface FileRow {
	path: string;
	title: string;
	artists: string;
	album: string | null;
	date: string | null;
	isrc: string | null;
	duration_ms: number | null;
	musicbrainz: string | null;
}

/**
 * Lowercase, without accents, with punctuation collapsed to spaces. It only selects candidates:
 * the matcher judges them.
 */
export function titleKey(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/** The title cut before its first bracket, dash or colon, as the Plex output's fallback search. */
export function cutTitle(title: string): string {
	return title.split(/[([{\-‐–—:]/)[0]?.trim() ?? "";
}

/** Whether `error` says the file isn't a usable SQLite database. */
function isDamaged(error: unknown): boolean {
	return (
		error instanceof SQLiteError &&
		(error.code === "SQLITE_NOTADB" || error.code === "SQLITE_CORRUPT")
	);
}

/**
 * The plugin's own index of the music folder: a cache that can be deleted at any time, so a
 * mismatch or a damaged file is rebuilt, never migrated (spec #179, decision 1). The handle never
 * leaves the handler that opened it.
 */
export class LibraryIndex {
	private constructor(private readonly db: Database) {}

	/** Opens `<configDir>/library.db` for `musicDir`, rebuilding it with a `warn` when it can't serve. */
	static open(configDir: string, musicDir: string, log: Log): LibraryIndex {
		mkdirSync(configDir, { recursive: true });
		const path = join(configDir, INDEX_FILE);
		try {
			return LibraryIndex.prepare(path, musicDir, log);
		} catch (error) {
			if (!isDamaged(error)) throw error;
			log.warn(`The music index ${path} was damaged, so it was deleted and is being rebuilt.`);
			for (const suffix of ["", "-wal", "-shm"]) rmSync(`${path}${suffix}`, { force: true });
			return LibraryIndex.prepare(path, musicDir, log);
		}
	}

	private static prepare(path: string, musicDir: string, log: Log): LibraryIndex {
		const db = new Database(path, { create: true, strict: true });
		try {
			db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
			db.run("PRAGMA journal_mode = WAL");
			db.transaction(() => {
				db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
				const meta = new Map(
					db
						.query<{ key: string; value: string }, []>("SELECT key, value FROM meta")
						.all()
						.map((row) => [row.key, row.value]),
				);
				const version = meta.get("version");
				const builtFor = meta.get("musicDir");
				if (version === SCHEMA_VERSION && builtFor === musicDir) return;
				if (version !== undefined) {
					const reason =
						version === SCHEMA_VERSION
							? `was built for ${builtFor}, not ${musicDir}`
							: "was built by another version of this plugin";
					log.warn(`The music index ${path} ${reason}, so it is being rebuilt.`);
				}
				db.run("DROP TABLE IF EXISTS files");
				db.run(SCHEMA);
				db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?), ('musicDir', ?)", [
					SCHEMA_VERSION,
					musicDir,
				]);
			}).immediate();
			return new LibraryIndex(db);
		} catch (error) {
			db.close();
			throw error;
		}
	}

	/** Every indexed file's stamp, by path. */
	stamps(): Map<string, FileStamp> {
		const rows = this.db
			.query<{ path: string; size: number; mtime_ms: number }, []>(
				"SELECT path, size, mtime_ms FROM files",
			)
			.all();
		return new Map(rows.map((row) => [row.path, { size: row.size, mtimeMs: row.mtime_ms }]));
	}

	/** Adds or replaces files, in one transaction. */
	write(files: readonly IndexedFile[]): void {
		const upsert = this.db.prepare(
			`INSERT OR REPLACE INTO files
				(path, size, mtime_ms, title, title_key, artists, album, date, isrc, duration_ms, musicbrainz)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		this.db
			.transaction(() => {
				for (const { path, size, mtimeMs, song } of files) {
					upsert.run(
						path,
						size,
						mtimeMs,
						song.title,
						titleKey(song.title),
						JSON.stringify(song.artists),
						song.album ?? null,
						song.date ?? null,
						song.isrc ?? null,
						song.durationMs ?? null,
						song.id?.musicbrainz ?? null,
					);
				}
			})
			.immediate();
	}

	/** Drops files the scan no longer found, in one transaction. */
	remove(paths: readonly string[]): void {
		const drop = this.db.prepare("DELETE FROM files WHERE path = ?");
		this.db
			.transaction(() => {
				for (const path of paths) drop.run(path);
			})
			.immediate();
	}

	/**
	 * The indexed files that could be `song`: by ISRC, MusicBrainz id and normalised title, or by the
	 * cut title when none of those finds any (spec #179, "Matching").
	 */
	candidates(song: Song): Song[] {
		const found = new Map<string, FileRow>();
		const add = (column: "isrc" | "musicbrainz" | "title_key", value: string | undefined) => {
			if (!value) return;
			const rows = this.db
				.query<FileRow, [string, number]>(
					`SELECT * FROM files WHERE ${column} = ? ORDER BY path LIMIT ?`,
				)
				.all(value, CANDIDATE_LIMIT);
			for (const row of rows) found.set(row.path, row);
		};
		add("isrc", song.isrc);
		add("musicbrainz", song.id.musicbrainz);
		const key = titleKey(song.title);
		add("title_key", key);
		if (found.size === 0) {
			const cut = titleKey(cutTitle(song.title));
			if (cut !== key) add("title_key", cut);
		}
		return [...found.values()].map(songOf);
	}

	close(): void {
		this.db.close();
	}
}

function songOf(row: FileRow): Song {
	return Song.parse({
		title: row.title,
		artists: JSON.parse(row.artists),
		album: row.album,
		date: row.date,
		isrc: row.isrc,
		durationMs: row.duration_ms,
		location: toFileUri(row.path),
		id: row.musicbrainz ? { musicbrainz: row.musicbrainz } : {},
	});
}
