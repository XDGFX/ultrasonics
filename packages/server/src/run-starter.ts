import { type RunQueue, runApplet } from "@ultrasonics/core";
import type { OpenDatabase, RunTrigger } from "@ultrasonics/db";
import type { PluginRegistry } from "@ultrasonics/plugin-sdk";
import type { RunNowResult } from "./api.ts";
import { createLocalAuthProvider } from "./auth/local-auth-provider.ts";
import type { PkceFlow } from "./auth/pkce-flow.ts";
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
	/** The server's one PKCE flow, so concurrent runs share a refresh and its rotated token. */
	pkce: PkceFlow;
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
	/**
	 * For shutdown: starts no more runs, so a queued one is lost as in a crash (ADR-0018 §4), and
	 * waits up to `graceMs` for the running ones to end before ending the rest as `interrupted`.
	 */
	drain(graceMs: number): Promise<void>;
}

export function createRunStarter(deps: RunStarterDeps): RunStarter {
	const { db, registry, catalogue, queue, hub, pkce, dataDir, logger } = deps;
	const operator = operatorSettings(db);
	const active = new Set<Promise<void>>();
	/** Applets whose queued run absorbed a run now, which records only the first trigger. */
	const manualAbsorbed = new Set<string>();
	let draining = false;

	/** One run, from its row to its end on the row; `begun` learns its id, or that there is none. */
	async function start(
		accountId: string,
		appletId: string,
		trigger: RunTrigger,
		fromQueue: boolean,
		begun: (runId: string | undefined) => void,
	): Promise<void> {
		const runNow = manualAbsorbed.delete(appletId) || trigger === "manual";
		if (draining) {
			logger.info(`Dropped a queued run of applet ${appletId}: the server is stopping`);
			return begun(undefined);
		}
		const store = db.storeFor(accountId);
		const applet = await store.applets.get(appletId);
		// Run now always runs; a trigger that fired before the applet was disabled does not.
		if (fromQueue && applet && !applet.enabled && !runNow) {
			logger.info(`Applet ${appletId} was disabled before its queued ${trigger} run`);
			return begun(undefined);
		}
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
					auth: await createLocalAuthProvider({
						accountId,
						db,
						operator,
						services: catalogue.services.keys(),
						pkce,
					}),
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
			// Read when the queue calls back: still false for a run it starts during `submit`.
			let fromQueue = false;
			const kind = queue.submit(appletId, trigger, (queued) => {
				const run = start(accountId, appletId, queued, fromQueue, resolve).catch((error) => {
					logger.error(`Starting a run of applet ${appletId} failed`, error);
					reject(error);
				});
				active.add(run);
				return run.finally(() => active.delete(run));
			});
			if (kind === "queued") {
				fromQueue = true;
				if (trigger === "manual") manualAbsorbed.add(appletId);
				return { kind };
			}
			const runId = await begun;
			return runId === undefined ? undefined : { kind, runId };
		},

		async drain(graceMs) {
			draining = true;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const graceOver = new Promise<"late">((resolve) => {
				timer = setTimeout(() => resolve("late"), graceMs);
			});
			const ended = Promise.all(active).then(() => "ended" as const);
			if ((await Promise.race([ended, graceOver])) === "late") {
				logger.warn(`Interrupting ${active.size} run(s) still going at shutdown`);
				await hub.interruptAll();
			}
			clearTimeout(timer);
		},
	};
}
