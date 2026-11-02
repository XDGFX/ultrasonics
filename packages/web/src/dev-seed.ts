import type { FakeSeed } from "./fake-api.ts";
import { catalogue } from "./fake-catalogue.ts";
import { authFailedRun, partialRun, succeededRun } from "./fake-runs.ts";

const hour = 3_600_000;
const now = Date.now();
const definition = {
	inputs: [{ plugin: "spotify", settings: { source: "chosen", names: "discover weekly" } }],
	modifiers: [{ plugin: "deduplicate", settings: {} }],
	outputs: [{ plugin: "plex", settings: { update: "replace" } }],
};

const live = { intervalMs: 700 };
const run = (id: string, appletId: string, startedAt: number) => ({
	id,
	appletId,
	trigger: "schedule" as const,
	status: "running" as const,
	startedAt,
	finishedAt: null,
});

/** What the fake-backed dev server shows; `?first-run` in the URL starts with no applets. */
export function devSeed(firstRun: boolean): FakeSeed {
	return {
		plugins: catalogue,
		grants: { plex: { kind: "connected" } },
		settings: { plex: { library: "music" } },
		runs: firstRun
			? []
			: [
					{ ...run("r3", "a1", now - 60_000), events: succeededRun, pace: live },
					{ ...run("r2", "a2", now - 26 * hour), events: partialRun },
					{ ...run("r1", "a3", now - 400 * hour), events: authFailedRun },
				],
		runScripts: Object.fromEntries(
			["a1", "a2", "a3"].map((id) => [id, { events: succeededRun, pace: live }]),
		),
		applets: firstRun
			? []
			: [
					{
						id: "a1",
						name: "discover weekly to plex",
						enabled: true,
						definition,
						schedule: {
							kind: "interval",
							unit: "day",
							count: 1,
							anchor: "2026-11-01T07:00:00",
							timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
						},
						hasWebhook: false,
						state: "running",
						lastRun: { id: "r3", status: "running", at: now - 60_000 },
						nextRunAt: now + 20 * hour,
					},
					{
						id: "a2",
						name: "release radar",
						enabled: true,
						definition,
						schedule: null,
						hasWebhook: true,
						lastRun: { id: "r2", status: "partial", at: now - 26 * hour },
					},
					{
						id: "a3",
						name: "old mixes",
						enabled: false,
						definition: { ...definition, modifiers: [] },
						schedule: null,
						hasWebhook: false,
						lastRun: { id: "r1", status: "failed", at: now - 400 * hour },
					},
				],
	};
}
