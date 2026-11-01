import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The AES-256-GCM key credentials are encrypted with. Opaque and non-extractable. */
export type EncryptionKey = CryptoKey;

export const AUTO_KEY_FILE = "ultrasonics.key";

const HEX_KEY = /^[0-9a-f]{64}$/i;

export class EncryptionKeyError extends Error {
	override readonly name = "EncryptionKeyError";

	constructor(
		readonly reason: "unset" | "malformed",
		/** A freshly generated key, ready for the operator to paste into `ENCRYPTION_KEY`. */
		readonly freshKey: string,
	) {
		super(
			reason === "unset"
				? "ENCRYPTION_KEY is not set"
				: "ENCRYPTION_KEY must be 64 hex characters or `auto`",
		);
	}
}

export type ResolvedEncryptionKey =
	| { ok: true; key: EncryptionKey }
	| { ok: false; error: EncryptionKeyError };

function generateHexKey(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

function importHexKey(hex: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", Buffer.from(hex, "hex"), "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

function readOrCreateKeyFile(databasePath: string): string {
	const dir = dirname(databasePath);
	const file = join(dir, AUTO_KEY_FILE);
	if (!existsSync(file)) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, `${generateHexKey()}\n`, { mode: 0o600, flag: "wx" });
		chmodSync(file, 0o600);
	}
	const hex = readFileSync(file, "utf8").trim();
	// A corrupt key file is not a configuration choice, so it never earns a fresh key to paste.
	if (!HEX_KEY.test(hex)) throw new Error(`The key file ${file} does not hold 64 hex characters`);
	return hex;
}

/**
 * Resolves `ENCRYPTION_KEY`: 64 hex characters, or `auto` to read or create a `0600` key file
 * beside the database (ADR-0009 §6).
 */
export async function resolveEncryptionKey(
	value: string | undefined,
	databasePath: string,
): Promise<ResolvedEncryptionKey> {
	const trimmed = value?.trim() ?? "";
	if (trimmed === "")
		return { ok: false, error: new EncryptionKeyError("unset", generateHexKey()) };
	if (trimmed === "auto") {
		return { ok: true, key: await importHexKey(readOrCreateKeyFile(databasePath)) };
	}
	if (!HEX_KEY.test(trimmed)) {
		return { ok: false, error: new EncryptionKeyError("malformed", generateHexKey()) };
	}
	return { ok: true, key: await importHexKey(trimmed) };
}
