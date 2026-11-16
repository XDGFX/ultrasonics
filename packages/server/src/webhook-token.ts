/** A new webhook token: 32 random bytes, base64url (ADR-0018 §5). */
export function newWebhookToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/**
 * The SHA-256 hex digest stored for a token. A token is found only by looking its hash up, so no
 * string comparison of secrets ever happens.
 */
export function webhookTokenHash(token: string): string {
	return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}
