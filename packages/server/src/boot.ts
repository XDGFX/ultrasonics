import { getConnInfo } from "@hono/bun";
import { createRunQueue } from "@ultrasonics/core";
import { type OpenDatabase, openDatabase } from "@ultrasonics/db";
import { systemModule } from "@ultrasonics/db/system";
import type { PluginRegistry } from "@ultrasonics/plugin-sdk";
import { createApp } from "./app.ts";
import { loadCatalogue } from "./catalogue.ts";
import { type ConfigurationProblem, parseConfiguration } from "./configuration.ts";
import type { Logger } from "./logger.ts";
import { IDLE_TIMEOUT_SECONDS } from "./run-routes.ts";

export interface BootOptions {
	env: Record<string, string | undefined>;
	registry: PluginRegistry;
	logger: Logger;
	/** Where data lives when `DATA_DIR` is unset: `/config` in the image, `./data` outside it. */
	defaultDataDir?: string;
	webRoot?: string;
}

/** What refused boot: a setting, or `plugins` for a build bug in the catalogue. */
export type BootResult =
	| { ok: true; server: Bun.Server<undefined>; stop(): void }
	| { ok: false; problems: ConfigurationProblem[] };

/**
 * Boots in ADR-0015 §3's order: configuration, the database (backup, migrate, the account),
 * interrupt leftover runs, the plugin catalogue, then listen. A database failure throws, for the
 * caller to exit loudly.
 */
export async function boot(options: BootOptions): Promise<BootResult> {
	const { logger } = options;
	const parsed = await parseConfiguration(options.env, {
		dataDir: options.defaultDataDir ?? "./data",
	});
	if (!parsed.ok) return parsed;
	const { configuration } = parsed;

	const db: OpenDatabase = await openDatabase({
		path: configuration.databasePath,
		encryptionKey: configuration.encryptionKey,
	});
	try {
		const interrupted = await systemModule(db).interruptRunning();
		logger.info(
			`Marked ${interrupted} run${interrupted === 1 ? "" : "s"} left running by the last process as interrupted`,
		);

		const catalogue = await loadCatalogue(options.registry);
		if (!catalogue.ok) {
			db.close();
			return {
				ok: false,
				problems: catalogue.problems.map((message) => ({ setting: "plugins", message })),
			};
		}

		const app = await createApp({
			configuration,
			db,
			registry: options.registry,
			catalogue: catalogue.catalogue,
			queue: createRunQueue(),
			clientAddress: (c) => getConnInfo(c).remote.address,
			logger,
			...(options.webRoot ? { webRoot: options.webRoot } : {}),
		});
		const server = Bun.serve({
			port: configuration.port,
			fetch: app.fetch,
			idleTimeout: IDLE_TIMEOUT_SECONDS,
		});
		logger.info(
			`ultrasonics is listening on ${server.url} (AUTH_SOURCE=${configuration.authSource})`,
		);
		return {
			ok: true,
			server,
			stop: () => {
				server.stop(true);
				db.close();
			},
		};
	} catch (error) {
		db.close();
		throw error;
	}
}
