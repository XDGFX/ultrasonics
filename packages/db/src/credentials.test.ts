import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CredentialKeyMismatchError, openDatabase, resolveEncryptionKey } from "@ultrasonics/db";
import { authStore } from "@ultrasonics/db/auth-store";
import { keyFrom, useTempDir, useTwoAccounts, withRawSqlite } from "./test-support.ts";

const grant = { accessToken: "access-plaintext-123", refreshToken: "refresh-plaintext-456" };

function storedSecrets(path: string): Buffer[] {
	return withRawSqlite(path, (raw) =>
		raw
			.query<{ secret: Uint8Array }, []>("SELECT secret FROM credentials")
			.all()
			.map((row) => Buffer.from(row.secret)),
	);
}

describe("store.credentials", () => {
	const tempDir = useTempDir();
	const twoAccounts = useTwoAccounts(tempDir);

	test("put, get and remove a grant as a plain document", async () => {
		const { db, mine } = await twoAccounts();
		const credentials = db.storeFor(mine).credentials;

		await credentials.put("spotify", grant, 9_000);
		expect(await credentials.get("spotify")).toEqual({ document: grant, expiresAt: 9_000 });

		await credentials.put("spotify", { accessToken: "renewed" }, null);
		expect(await credentials.get("spotify")).toEqual({
			document: { accessToken: "renewed" },
			expiresAt: null,
		});

		expect(await credentials.remove("spotify")).toBe(true);
		expect(await credentials.get("spotify")).toBeUndefined();
	});

	test("the stored blob holds none of the plaintext", async () => {
		const { db, mine, path } = await twoAccounts();
		await db.storeFor(mine).credentials.put("spotify", grant, null);

		const [secret] = storedSecrets(path);
		for (const plaintext of [...Object.values(grant), ...Object.keys(grant)]) {
			expect(secret?.includes(plaintext)).toBe(false);
		}
	});

	test("two writes of the same document produce different blobs", async () => {
		const { db, mine, path } = await twoAccounts();
		const credentials = db.storeFor(mine).credentials;

		await credentials.put("spotify", grant, null);
		const [first] = storedSecrets(path);
		await credentials.put("spotify", grant, null);
		const [second] = storedSecrets(path);

		expect(first).toBeDefined();
		expect(second?.equals(first as Buffer)).toBe(false);
	});

	test("reading with a different key throws, naming the service", async () => {
		const { db, mine, path } = await twoAccounts();
		await db.storeFor(mine).credentials.put("spotify", grant, null);
		db.close();

		const reopened = await openDatabase({ path, encryptionKey: await keyFrom("1".repeat(64)) });
		try {
			const reading = reopened.storeFor(mine).credentials.get("spotify");
			await expect(reading).rejects.toBeInstanceOf(CredentialKeyMismatchError);
			await expect(reading).rejects.toHaveProperty("service", "spotify");
		} finally {
			reopened.close();
		}
	});

	test("an auto key read back on the next boot decrypts what the first boot wrote", async () => {
		const path = join(tempDir(), "ultrasonics.db");
		const boot = async () => {
			const resolved = await resolveEncryptionKey("auto", path);
			if (!resolved.ok) throw resolved.error;
			return openDatabase({ path, encryptionKey: resolved.key });
		};

		const first = await boot();
		const accountId = await authStore(first).installAccount();
		await first.storeFor(accountId).credentials.put("spotify", grant, null);
		first.close();

		const second = await boot();
		try {
			expect(await second.storeFor(accountId).credentials.get("spotify")).toHaveProperty(
				"document",
				grant,
			);
		} finally {
			second.close();
		}
	});
});

describe("store.pluginSettings", () => {
	const twoAccounts = useTwoAccounts(useTempDir());

	test("put, get and remove a plugin's settings", async () => {
		const { db, mine } = await twoAccounts();
		const settings = db.storeFor(mine).pluginSettings;
		const value = { url: "http://plex.local:32400", threshold: 0.8 };

		await settings.put("plex", value);
		expect(await settings.get("plex")).toEqual(value);

		await settings.put("plex", { threshold: 0.9 });
		expect(await settings.get("plex")).toEqual({ threshold: 0.9 });

		expect(await settings.remove("plex")).toBe(true);
		expect(await settings.get("plex")).toBeUndefined();
	});
});
