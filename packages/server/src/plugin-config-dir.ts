import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * A plugin's config directory for one account, created on first use (spec #134, decision 9). Core
 * only ever sees the path (ADR-0010 #8).
 */
export async function pluginConfigDir(
	dataDir: string,
	accountId: string,
	plugin: string,
): Promise<string> {
	const dir = join(dataDir, "accounts", accountId, "plugins", plugin);
	await mkdir(dir, { recursive: true });
	return dir;
}
