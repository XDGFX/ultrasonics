import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AUTO_KEY_FILE, EncryptionKeyError, resolveEncryptionKey } from "@ultrasonics/db";
import { useTempDir } from "./test-support.ts";

const HEX_64 = /^[0-9a-f]{64}$/;

describe("resolveEncryptionKey", () => {
	const tempDir = useTempDir();
	const databasePath = () => join(tempDir(), "ultrasonics.db");

	test("accepts 64 hex characters", async () => {
		const resolved = await resolveEncryptionKey("aB".repeat(32), databasePath());
		expect(resolved.ok).toBe(true);
	});

	test("auto creates a 0600 key file once and reads it back after", async () => {
		const first = await resolveEncryptionKey("auto", databasePath());
		const keyFile = join(tempDir(), AUTO_KEY_FILE);
		const written = readFileSync(keyFile, "utf8");

		const second = await resolveEncryptionKey("auto", databasePath());

		expect(first.ok && second.ok).toBe(true);
		expect(statSync(keyFile).mode & 0o777).toBe(0o600);
		expect(written.trim()).toMatch(HEX_64);
		expect(readFileSync(keyFile, "utf8")).toBe(written);
	});

	test.each([
		["unset", undefined, "unset"],
		["empty", "", "unset"],
		["too short", "ab".repeat(31), "malformed"],
		["not hex", "zz".repeat(32), "malformed"],
	] as const)("an %s value is an error carrying a fresh key", async (_, value, reason) => {
		const resolved = await resolveEncryptionKey(value, databasePath());

		if (resolved.ok) throw new Error("expected an error");
		expect(resolved.error).toBeInstanceOf(EncryptionKeyError);
		expect(resolved.error.reason).toBe(reason);
		expect(resolved.error.freshKey).toMatch(HEX_64);
		expect(await resolveEncryptionKey(resolved.error.freshKey, databasePath())).toHaveProperty(
			"ok",
			true,
		);
	});
});
