import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A plugin's config directory for one account, created on first use (spec #134, decision 9). Core
 * only ever sees the path (ADR-0010 #8), and asks for it synchronously.
 */
export function pluginConfigDir(dataDir: string, accountId: string, plugin: string): string {
	const dir = join(dataDir, "accounts", accountId, "plugins", plugin);
	mkdirSync(dir, { recursive: true });
	return dir;
}
