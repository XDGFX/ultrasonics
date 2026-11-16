import { getConnInfo } from "@hono/bun";
import { createRunQueue } from "@ultrasonics/core";
import { type OpenDatabase, openDatabase, V1DatabaseError } from "@ultrasonics/db";
import { systemModule } from "@ultrasonics/db/system";
import type { PluginRegistry } from "@ultrasonics/plugin-sdk";
import { createApp } from "./app.ts";
import { PkceFlow, type PkceFlowOptions } from "./auth/pkce-flow.ts";
import { loadCatalogue } from "./catalogue.ts";
import {
	type ConfigurationProblem,
	DATABASE_FILE,
	parseConfiguration,
	V1_DATABASE_FILE,
} from "./configuration.ts";
import type { Logger } from "./logger.ts";
import { IDLE_TIMEOUT_SECONDS } from "./run-routes.ts";

export interface BootOptions {
	env: Record<string, string | undefined>;
	registry: PluginRegistry;
	logger: Logger;
	/** Where data lives when `DATA_DIR` is unset: `/config` in the image, `./data` outside it. */
	defaultDataDir?: string;
	webRoot?: string;
	/** Where `oauth2-pkce` services authorise; the real services' when absent. */
	oauth?: PkceFlowOptions;
	/** How long `stop` waits for running runs; {@link SHUTDOWN_GRACE_MS} when absent. */
	shutdownGraceMs?: number;
}

/**
 * How long a stop waits for running runs to end, leaving Docker's 10 s room for the interrupted
 * runs' writes on a slow disk before it kills the process.
 */
export const SHUTDOWN_GRACE_MS = 7_000;

/** How the log line that boot is serving begins, which tests wait on. */
export const LISTENING = "ultrasonics is listening on";

function v1DatabaseRefusal(path: string): string {
	return `${path} is a v1 ultrasonics database, so v2 will not migrate it. v2 keeps its own database in ${DATABASE_FILE} and imports v1's from ${V1_DATABASE_FILE} in the same directory, reading it without modifying it. Keep v1's database as ${V1_DATABASE_FILE}; v2 creates its own beside it.`;
}

/** What refused boot: a setting, or `plugins` for a build bug in the catalogue. */
export type BootResult =
	| { ok: true; server: Bun.Server<undefined>; stop(): Promise<void> }
	| { ok: false; problems: ConfigurationProblem[] };

/**
 * Boots in ADR-0015 §3's order: configuration, the database (backup, migrate, the account),
 * interrupt leftover runs, the plugin catalogue, the scheduler, then listen. A database failure
 * throws, for the caller to exit loudly.
 */
export async function boot(options: BootOptions): Promise<BootResult> {
	const { logger } = options;
	const parsed = await parseConfiguration(options.env, {
		dataDir: options.defaultDataDir ?? "./data",
	});
	if (!parsed.ok) return parsed;
	const { configuration } = parsed;

	let db: OpenDatabase;
	try {
		db = await openDatabase({
			path: configuration.databasePath,
			encryptionKey: configuration.encryptionKey,
		});
	} catch (error) {
		if (!(error instanceof V1DatabaseError)) throw error;
		return {
			ok: false,
			problems: [{ setting: "DATA_DIR", message: v1DatabaseRefusal(error.path) }],
		};
	}
	try {
		const interrupted = await systemModule(db).interruptRunning(Date.now());
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

		const { app, scheduler, runs } = await createApp({
			configuration,
			db,
			registry: options.registry,
			catalogue: catalogue.catalogue,
			queue: createRunQueue(),
			clientAddress: (c) => getConnInfo(c).remote.address,
			logger,
			...(options.webRoot ? { webRoot: options.webRoot } : {}),
			...(options.oauth ? { pkce: new PkceFlow(options.oauth) } : {}),
		});
		// The first tick is now, which is how a slot missed while the server was down runs once.
		scheduler.start();
		const server = Bun.serve({
			port: configuration.port,
			fetch: app.fetch,
			idleTimeout: IDLE_TIMEOUT_SECONDS,
		});
		logger.info(`${LISTENING} ${server.url} (AUTH_SOURCE=${configuration.authSource})`);
		return {
			ok: true,
			server,
			stop: async () => {
				await server.stop(true);
				await scheduler.stop();
				await runs.drain(options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS);
				db.close();
			},
		};
	} catch (error) {
		db.close();
		throw error;
	}
}
