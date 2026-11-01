import { Database as Sqlite } from "bun:sqlite";
import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AppletDefinition,
	type EncryptionKey,
	type OpenDatabase,
	openDatabase,
	type RunJournal,
	resolveEncryptionKey,
	type Schedule,
} from "@ultrasonics/db";
import { authStore } from "@ultrasonics/db/auth-store";

/** A fresh temporary directory per test, removed afterwards. */
export function useTempDir(): () => string {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});
	return () => {
		dir ??= mkdtempSync(join(tmpdir(), "ultrasonics-db-"));
		return dir;
	};
}

export async function keyFrom(hex: string): Promise<EncryptionKey> {
	const resolved = await resolveEncryptionKey(hex, "/unused/ultrasonics.db");
	if (!resolved.ok) throw resolved.error;
	return resolved.key;
}

export const TEST_KEY_HEX = "0".repeat(64);

/** Runs `use` on a raw connection to the file at `path`, bypassing the package, then closes it. */
export function withRawSqlite<T>(path: string, use: (raw: Sqlite) => T): T {
	const raw = new Sqlite(path, { strict: true });
	try {
		return use(raw);
	} finally {
		raw.close();
	}
}

/** Inserts raw rows the package has no public writer for in Phase 1 (other accounts, sessions). */
export function seed(path: string, statement: string, ...values: (string | number)[]): void {
	withRawSqlite(path, (raw) => raw.query(statement).run(...values));
}

export interface TwoAccounts {
	path: string;
	db: OpenDatabase;
	mine: string;
	theirs: string;
}

/** An open database holding the install's account and a second one, closed after each test. */
export function useTwoAccounts(tempDir: () => string): () => Promise<TwoAccounts> {
	let open: OpenDatabase | undefined;
	afterEach(() => {
		open?.close();
		open = undefined;
	});
	return async () => {
		const path = join(tempDir(), "ultrasonics.db");
		const db = await openDatabase({ path, encryptionKey: await keyFrom(TEST_KEY_HEX) });
		open = db;
		const theirs = Bun.randomUUIDv7();
		seed(path, "INSERT INTO accounts (id, created_at) VALUES (?, ?)", theirs, Date.now());
		return { path, db, mine: await authStore(db).installAccount(), theirs };
	};
}

export const definition: AppletDefinition = {
	inputs: [{ plugin: "spotify", settings: { playlist: "Discover Weekly" } }],
	modifiers: [],
	outputs: [{ plugin: "plex", settings: { library: "Music" } }],
};

export const schedule: Schedule = {
	kind: "interval",
	unit: "day",
	count: 1,
	anchor: "2026-11-01T03:00",
	timeZone: "Australia/Sydney",
};

export const journal: RunJournal = {
	log: [{ level: "info", message: "Fetched 12 songs" }],
	stages: [{ component: "inputs", index: 0, songs: 12 }],
	results: [],
};
