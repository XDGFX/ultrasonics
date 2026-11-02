import type { FakeSeed } from "./fake-api.ts";
import { catalogue } from "./fake-catalogue.ts";

const hour = 3_600_000;
const now = Date.now();
const definition = {
	inputs: [{ plugin: "spotify", settings: { source: "chosen", names: "discover weekly" } }],
	modifiers: [{ plugin: "deduplicate", settings: {} }],
	outputs: [{ plugin: "plex", settings: { update: "replace" } }],
};

/** What the fake-backed dev server shows; `?first-run` in the URL starts with no applets. */
export function devSeed(firstRun: boolean): FakeSeed {
	return {
		plugins: catalogue,
		grants: { plex: { kind: "connected" } },
		settings: { plex: { library: "music" } },
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
