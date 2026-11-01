import { JsonObject } from "./json.ts";

export const CURRENT_KEY_VERSION = 1;

const NONCE_BYTES = 12;

export class CredentialKeyMismatchError extends Error {
	override readonly name = "CredentialKeyMismatchError";

	constructor(readonly service: string) {
		super(
			`The stored credential for ${service} cannot be decrypted: ENCRYPTION_KEY does not match the key it was written with`,
		);
	}
}

/** AES-256-GCM, stored as `nonce ‖ ciphertext ‖ tag` (ADR-0009 §6). */
export async function encryptCredential(key: CryptoKey, document: JsonObject): Promise<Buffer> {
	const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
	const plaintext = new TextEncoder().encode(JSON.stringify(document));
	const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
	return Buffer.concat([nonce, new Uint8Array(sealed)]);
}

export async function decryptCredential(
	key: CryptoKey,
	service: string,
	stored: Uint8Array,
): Promise<JsonObject> {
	const secret = new Uint8Array(stored);
	let plaintext: ArrayBuffer;
	try {
		plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: secret.subarray(0, NONCE_BYTES) },
			key,
			secret.subarray(NONCE_BYTES),
		);
	} catch {
		throw new CredentialKeyMismatchError(service);
	}
	return JsonObject.parse(JSON.parse(new TextDecoder().decode(plaintext)));
}
