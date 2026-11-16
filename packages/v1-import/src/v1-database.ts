import { Database as Sqlite } from "bun:sqlite";

/** The tables and columns v1's `database.py` creates (ADR-0017 §1). */
const V1_SHAPE: Record<string, string[]> = {
	ultrasonics: ["key", "value"],
	plugins: ["id", "plugin", "version", "settings"],
	applets: ["id", "lastrun", "data"],
};

/** The file is not a v1 database, or could not be read; the whole import aborts (ADR-0017 §6). */
export class NotV1DatabaseError extends Error {
	override readonly name = "NotV1DatabaseError";
}

/** One `plugins` row: a v1 plugin at one version, with its persistent settings blob, if any. */
export interface V1PluginRow {
	id: number;
	plugin: string | null;
	/** SQLite's text form of v1's `FLOAT` column, so `0.5` reads as `"0.5"`. */
	version: string | null;
	settings: string | null;
}

export interface V1AppletRow {
	id: string;
	data: string | null;
}

export interface V1Database {
	/** v1's `version` row, written once at first install and never updated. */
	firstInstalledAs: string | undefined;
	plugins: V1PluginRow[];
	applets: V1AppletRow[];
}

function checkShape(sqlite: Sqlite): void {
	for (const [table, columns] of Object.entries(V1_SHAPE)) {
		const found = new Set(
			sqlite
				.query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${table}')`)
				.all()
				.map((column) => column.name),
		);
		const missing = columns.filter((column) => !found.has(column));
		if (found.size === 0) throw new NotV1DatabaseError(`It has no \`${table}\` table.`);
		if (missing.length > 0) {
			throw new NotV1DatabaseError(`Its \`${table}\` table has no ${missing.join(", ")} column.`);
		}
	}
}

/**
 * Reads v1's database through a read-only connection, so the file is never changed (ADR-0017 §1).
 * Throws {@link NotV1DatabaseError} for a file that is not v1's, or not a database at all.
 */
export function readV1Database(path: string): V1Database {
	let sqlite: Sqlite;
	try {
		sqlite = new Sqlite(path, { readonly: true, strict: true });
	} catch (error) {
		throw new NotV1DatabaseError(`It could not be opened: ${String(error)}`);
	}
	try {
		checkShape(sqlite);
		const version = sqlite
			.query<{ value: string | null }, []>(
				"SELECT value FROM ultrasonics WHERE key = 'version' LIMIT 1",
			)
			.get()?.value;
		return {
			firstInstalledAs: version ?? undefined,
			plugins: sqlite
				.query<V1PluginRow, []>(
					"SELECT id, plugin, CAST(version AS TEXT) AS version, settings FROM plugins ORDER BY id",
				)
				.all(),
			applets: sqlite.query<V1AppletRow, []>("SELECT id, data FROM applets ORDER BY rowid").all(),
		};
	} catch (error) {
		if (error instanceof NotV1DatabaseError) throw error;
		throw new NotV1DatabaseError(`It could not be read: ${String(error)}`);
	} finally {
		sqlite.close();
	}
}
