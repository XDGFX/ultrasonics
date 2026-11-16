import { Database as Sqlite } from "bun:sqlite";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";
import { createAccountStore } from "./account-store.ts";
import { type Connection, forget, type OpenDatabase, register } from "./connection.ts";
import type { EncryptionKey } from "./encryption-key.ts";
import * as schema from "./schema.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export interface OpenOptions {
	path: string;
	encryptionKey: EncryptionKey;
	/** Tests only: a folder of drizzle-kit migrations to apply instead of the package's own. */
	migrationsFolder?: string;
}

const MigrationJournal = z.object({
	entries: z.array(z.object({ when: z.number(), tag: z.string() })),
});

const MIGRATIONS_TABLE = "__drizzle_migrations";

/** The tables v1's `database.py` creates; ADR-0017 §1 recognises a v1 database by them. */
const V1_TABLES = ["ultrasonics", "plugins", "applets"];

/** The file at `path` is v1's database, which v2 never migrates (ADR-0017 §1). */
export class V1DatabaseError extends Error {
	override readonly name = "V1DatabaseError";

	constructor(readonly path: string) {
		super(`${path} holds v1's tables and no migration table`);
	}
}

function tablesIn(sqlite: Sqlite): Set<string> {
	const rows = sqlite
		.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
		.all();
	return new Set(rows.map((row) => row.name));
}

/** Read through a read-only connection, so a v1 file is refused without being written. */
function looksLikeV1(path: string): boolean {
	const sqlite = new Sqlite(path, { readonly: true });
	try {
		const tables = tablesIn(sqlite);
		return !tables.has(MIGRATIONS_TABLE) && V1_TABLES.every((name) => tables.has(name));
	} finally {
		sqlite.close();
	}
}

function lastAppliedMigration(sqlite: Sqlite): number | undefined {
	if (!tablesIn(sqlite).has(MIGRATIONS_TABLE)) return undefined;
	const row = sqlite
		.query<{ created_at: number }, []>(
			"SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
		)
		.get();
	return row ? Number(row.created_at) : undefined;
}

function tagOf(migrationsFolder: string, appliedAt: number | undefined): string {
	if (appliedAt === undefined) return "none";
	const journal = MigrationJournal.parse(
		JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")),
	);
	return journal.entries.find((entry) => entry.when === appliedAt)?.tag ?? String(appliedAt);
}

function backUpBeforeMigrating(sqlite: Sqlite, path: string, migrationsFolder: string): void {
	const appliedAt = lastAppliedMigration(sqlite);
	const pending = readMigrationFiles({ migrationsFolder }).some(
		(migration) => appliedAt === undefined || migration.folderMillis > appliedAt,
	);
	if (pending) copyFileSync(path, `${path}.pre-${tagOf(migrationsFolder, appliedAt)}`);
}

/**
 * The open step (ADR-0015 §3): back up the file if a migration is pending, apply pending
 * migrations, and make sure the install's account exists. A failed migration throws, and a v1
 * database throws {@link V1DatabaseError} before anything writes to it.
 */
export async function openDatabase(options: OpenOptions): Promise<OpenDatabase> {
	const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
	const existed = existsSync(options.path);
	if (existed && looksLikeV1(options.path)) throw new V1DatabaseError(options.path);
	const sqlite = new Sqlite(options.path, { create: true, strict: true });
	try {
		sqlite.run("PRAGMA foreign_keys = ON");
		if (existed) backUpBeforeMigrating(sqlite, options.path, migrationsFolder);
		const db = drizzle({ client: sqlite, schema });
		migrate(db, { migrationsFolder });
		db.run(
			sql`INSERT INTO accounts (id, created_at)
				SELECT ${Bun.randomUUIDv7()}, ${Date.now()}
				WHERE NOT EXISTS (SELECT 1 FROM accounts)`,
		);

		const connection: Connection = { db, encryptionKey: options.encryptionKey };
		const handle: OpenDatabase = {
			storeFor: (accountId) => createAccountStore(connection, accountId),
			close: () => {
				if (forget(handle)) sqlite.close();
			},
		};
		register(handle, connection);
		return handle;
	} catch (error) {
		sqlite.close();
		throw error;
	}
}
