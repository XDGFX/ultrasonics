import { type RunQueue, runApplet } from "@ultrasonics/core";
import type { OpenDatabase, RunTrigger } from "@ultrasonics/db";
import type { PluginRegistry } from "@ultrasonics/plugin-sdk";
import type { RunNowResult } from "./api.ts";
import { createLocalAuthProvider } from "./auth/local-auth-provider.ts";
import type { Catalogue } from "./catalogue.ts";
import type { Logger } from "./logger.ts";
import { operatorSettings } from "./operator-settings.ts";
import { pluginConfigDir } from "./plugin-config-dir.ts";
import type { RunHub } from "./run-hub.ts";

export interface RunStarterDeps {
	db: OpenDatabase;
	registry: PluginRegistry;
	catalogue: Catalogue;
	queue: RunQueue;
	hub: RunHub;
	dataDir: string;
	logger: Logger;
}

export interface RunStarter {
	/**
	 * Submits a run of one of the account's applets to the run queue, the one rule for every trigger
	 * (#110). `started` once its row exists, `queued` behind the applet's current run, or `undefined`
	 * when the applet is gone by the time it would start.
	 */
	submit(
		accountId: string,
		appletId: string,
		trigger: RunTrigger,
	): Promise<RunNowResult | undefined>;
}

export function createRunStarter(deps: RunStarterDeps): RunStarter {
	const { db, registry, catalogue, queue, hub, dataDir, logger } = deps;
	const operator = operatorSettings(db);

	/** One run, from its row to its end on the row; `begun` learns its id, or that there is none. */
	async function start(
		accountId: string,
		appletId: string,
		trigger: RunTrigger,
		begun: (runId: string | undefined) => void,
	): Promise<void> {
		const store = db.storeFor(accountId);
		const applet = await store.applets.get(appletId);
		const runId = applet && (await store.runs.start(appletId, trigger));
		if (!applet || !runId) {
			logger.info(`Applet ${appletId} was deleted before its queued run`);
			return begun(undefined);
		}
		begun(runId);

		const journal = hub.open(runId, {
			checkpoint: (columns) => store.runs.checkpoint(runId, columns),
			finish: (status, columns) => store.runs.finish(runId, status, columns),
		});
		try {
			await runApplet({
				runId,
				applet: { id: applet.id, name: applet.name, definition: applet.definition },
				trigger,
				registry,
				capabilities: {
					auth: await createLocalAuthProvider(store, operator, catalogue.services.keys()),
					persistentSettings: (plugin) => store.pluginSettings.get(plugin),
					configDir: (plugin) => pluginConfigDir(dataDir, accountId, plugin),
				},
				events: journal,
			});
		} catch (error) {
			// Plugin failures end the run themselves; this is the host failing, a lost key among them.
			logger.error(`Run ${runId} of applet ${appletId} failed outside its plugins`, error);
			await journal.fail();
		}
		await journal.closed;
	}

	return {
		async submit(accountId, appletId, trigger) {
			const { promise: begun, resolve, reject } = Promise.withResolvers<string | undefined>();
			// A queued run's id is awaited by nobody; its failure is logged below, not unhandled.
			begun.catch(() => {});
			const kind = queue.submit(appletId, trigger, (queued) =>
				start(accountId, appletId, queued, resolve).catch((error) => {
					logger.error(`Starting a run of applet ${appletId} failed`, error);
					reject(error);
				}),
			);
			if (kind === "queued") return { kind };
			const runId = await begun;
			return runId === undefined ? undefined : { kind, runId };
		},
	};
}
