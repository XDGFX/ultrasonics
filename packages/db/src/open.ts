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

function lastAppliedMigration(sqlite: Sqlite): number | undefined {
	const table = sqlite
		.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
		.get();
	if (!table) return undefined;
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
 * migrations, and make sure the install's account exists. A failed migration throws.
 */
export async function openDatabase(options: OpenOptions): Promise<OpenDatabase> {
	const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
	const existed = existsSync(options.path);
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
