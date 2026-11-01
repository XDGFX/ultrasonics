import { SQLiteError } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "@ultrasonics/db";
import { authStore } from "@ultrasonics/db/auth-store";
import { keyFrom, TEST_KEY_HEX, useTempDir, withRawSqlite } from "./test-support.ts";

const PACKAGE_MIGRATIONS = join(import.meta.dir, "..", "migrations");

const key = () => keyFrom(TEST_KEY_HEX);

function countAccounts(path: string): number {
	return withRawSqlite(
		path,
		(raw) => raw.query<{ n: number }, []>("SELECT count(*) AS n FROM accounts").get()?.n ?? 0,
	);
}

describe("openDatabase", () => {
	const tempDir = useTempDir();

	test("a fresh path gets the schema and exactly one account", async () => {
		const path = join(tempDir(), "ultrasonics.db");
		const db = await openDatabase({ path, encryptionKey: await key() });
		const accountId = await authStore(db).installAccount();
		db.close();

		expect(accountId).toBeString();
		expect(countAccounts(path)).toBe(1);
	});

	test("reopening keeps the same single account", async () => {
		const path = join(tempDir(), "ultrasonics.db");
		const first = await openDatabase({ path, encryptionKey: await key() });
		const accountId = await authStore(first).installAccount();
		first.close();

		const second = await openDatabase({ path, encryptionKey: await key() });
		expect(await authStore(second).installAccount()).toBe(accountId);
		second.close();
		expect(countAccounts(path)).toBe(1);
	});

	describe("with a second migration pending", () => {
		function foldersWithSecondMigration(statement: string): string {
			const folder = join(tempDir(), "migrations");
			cpSync(PACKAGE_MIGRATIONS, folder, { recursive: true });
			const journalPath = join(folder, "meta", "_journal.json");
			const journal = JSON.parse(readFileSync(journalPath, "utf8"));
			const last = journal.entries.at(-1);
			journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: "0001_next" });
			writeFileSync(journalPath, JSON.stringify(journal));
			writeFileSync(join(folder, "0001_next.sql"), statement);
			return folder;
		}

		async function openOnceThenClose(path: string) {
			(await openDatabase({ path, encryptionKey: await key() })).close();
		}

		test("copies the file to .pre-<last applied tag> before migrating", async () => {
			const path = join(tempDir(), "ultrasonics.db");
			await openOnceThenClose(path);
			const before = readFileSync(path);

			const migrationsFolder = foldersWithSecondMigration("CREATE TABLE `extra` (`id` text);");
			const db = await openDatabase({ path, encryptionKey: await key(), migrationsFolder });
			db.close();

			expect(readFileSync(`${path}.pre-0000_initial`)).toEqual(before);
		});

		test("a failing migration throws and leaves the original byte-identical", async () => {
			const path = join(tempDir(), "ultrasonics.db");
			await openOnceThenClose(path);
			const before = readFileSync(path);

			const migrationsFolder = foldersWithSecondMigration(
				"CREATE TABLE `extra` (`id` text);\n--> statement-breakpoint\nNOT VALID SQL;",
			);
			const opening = key().then((encryptionKey) =>
				openDatabase({ path, encryptionKey, migrationsFolder }),
			);

			await expect(opening).rejects.toMatchObject({ cause: expect.any(SQLiteError) });
			expect(readFileSync(path)).toEqual(before);
			expect(readFileSync(`${path}.pre-0000_initial`)).toEqual(before);
		});

		test("no copy is taken when nothing is pending", async () => {
			const path = join(tempDir(), "ultrasonics.db");
			await openOnceThenClose(path);
			await openOnceThenClose(path);

			expect(readdirSync(tempDir()).filter((name) => name.includes(".pre-"))).toEqual([]);
		});
	});
});
