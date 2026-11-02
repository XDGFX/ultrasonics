import {
	type AuthRequirement,
	type AuthSpec,
	type Component,
	type IssuePath,
	type Mode,
	type Service,
	type SettingsSchema,
	toFormSchema,
	type ValidationIssue,
} from "@ultrasonics/plugin-sdk";
import type { z } from "zod";
import type {
	ApiClient,
	Applet,
	AppletDraft,
	AppletListing,
	PluginInfo,
	RunNowResult,
	RunSummary,
	SaveResult,
	ServiceStatus,
} from "./api-client.ts";
import { type RunScript, type ScriptedRun, scriptedRun } from "./scripted-run.ts";

/** A plugin as the fake holds it: Zod schemas, which the fake serves through `toFormSchema`. */
export interface FakePlugin {
	name: string;
	description: string;
	version: string;
	mode: Mode[];
	auth?: AuthSpec;
	persistentSettings?: SettingsSchema;
	instanceSettings: Partial<Record<Component, SettingsSchema>>;
}

export type FakeApplet = Applet & Partial<Pick<AppletListing, "state" | "lastRun" | "nextRunAt">>;

export interface FakeSeed {
	plugins: FakePlugin[];
	exposed?: boolean;
	applets?: FakeApplet[];
	grants?: Partial<Record<Service, ServiceStatus["status"]>>;
	/** Stored persistent settings by plugin name, which need not parse. */
	settings?: Record<string, unknown>;
	runs?: (RunSummary & RunScript)[];
	/** What run now plays for each applet, by applet id; an applet without one runs silently. */
	runScripts?: Record<string, RunScript>;
	/** A token service whose test fails with this message after its fields validate. */
	testFailures?: Partial<Record<Service, string>>;
	/** `oauth2*` services whose operator has not registered an app. */
	unregisteredClients?: Service[];
}

function formSchema(schema: z.ZodType, options: { auth?: boolean } = {}) {
	const result = toFormSchema(schema, options);
	if (!result.ok) {
		throw new Error(`A fake plugin's schema is not renderable: ${JSON.stringify(result.issues)}`);
	}
	return result.jsonSchema;
}

function issuesOf(error: z.ZodError, prefix: IssuePath = []): ValidationIssue[] {
	return error.issues.map((issue) => ({
		path: [...prefix, ...issue.path.map((key) => (typeof key === "symbol" ? String(key) : key))],
		message: issue.message,
	}));
}

function pluginInfo(plugin: FakePlugin): PluginInfo {
	const instanceSettings: PluginInfo["instanceSettings"] = {};
	for (const [component, schema] of Object.entries(plugin.instanceSettings)) {
		instanceSettings[component as Component] = formSchema(schema);
	}
	return {
		name: plugin.name,
		description: plugin.description,
		version: plugin.version,
		components: Object.keys(plugin.instanceSettings) as Component[],
		mode: plugin.mode,
		...(plugin.auth ? { service: plugin.auth.service } : {}),
		...(plugin.persistentSettings
			? { persistentSettings: formSchema(plugin.persistentSettings) }
			: {}),
		instanceSettings,
	};
}

const neverRun = { state: "idle", lastRun: null, nextRunAt: null } as const;

/** Drives the fake's scripted runs from a test. */
export interface ScriptControl {
	advance(runId: string, count?: number): void;
	drop(runId: string): void;
	connections(runId: string): number;
}

/** An in-memory `ApiClient` for tests and the fake-backed dev server. */
export function createFakeApi(seed: FakeSeed): ApiClient & { scripts: ScriptControl } {
	const plugins = new Map(seed.plugins.map((plugin) => [plugin.name, plugin]));
	const catalogue = seed.plugins.map(pluginInfo);
	const applets = new Map<string, AppletListing>(
		(seed.applets ?? []).map((applet) => [applet.id, { ...neverRun, ...applet }]),
	);
	const settings = new Map(Object.entries(seed.settings ?? {}));
	const grants = new Map(Object.entries(seed.grants ?? {})) as Map<
		Service,
		ServiceStatus["status"]
	>;
	const runs = new Map<string, RunSummary>();
	const scripts = new Map<string, ScriptedRun>();
	let nextId = 1;

	const startRun = (summary: RunSummary, script: RunScript, startedNow: boolean) => {
		runs.set(summary.id, summary);
		const run = scriptedRun(
			script,
			(end) => {
				summary.status = end.status;
				summary.finishedAt = end.at;
				const applet = applets.get(summary.appletId);
				if (!applet || applet.lastRun?.id !== summary.id) return;
				applet.lastRun.status = end.status;
				const queued = applet.state === "queued";
				applet.state = "idle";
				// Queue depth one: the absorbed firings run once the current run ends.
				if (queued) runNow(applet);
			},
			startedNow ? summary.startedAt : undefined,
		);
		scripts.set(summary.id, run);
		run.start();
	};

	const runNow = (applet: AppletListing): RunNowResult => {
		if (applet.state !== "idle") {
			applet.state = "queued";
			return { kind: "queued" };
		}
		const runId = `run-${nextId++}`;
		const startedAt = Date.now();
		applet.state = "running";
		applet.lastRun = { id: runId, status: "running", at: startedAt };
		const summary: RunSummary = {
			id: runId,
			appletId: applet.id,
			trigger: "manual",
			status: "running",
			startedAt,
			finishedAt: null,
		};
		startRun(summary, seed.runScripts?.[applet.id] ?? { events: [] }, true);
		return { kind: "started", runId };
	};

	for (const { events, pace, ...summary } of seed.runs ?? []) {
		startRun({ ...summary }, { events, ...(pace ? { pace } : {}) }, false);
	}

	const script = (runId: string): ScriptedRun => {
		const run = scripts.get(runId);
		if (!run) throw new Error(`No run ${runId}`);
		return run;
	};

	const authSpec = (service: Service): AuthSpec => {
		const spec = seed.plugins.find((plugin) => plugin.auth?.service === service)?.auth;
		if (!spec) throw new Error(`No fake plugin uses ${service}`);
		return spec;
	};

	const checkDraft = (draft: AppletDraft): ValidationIssue[] => {
		const issues: ValidationIssue[] =
			draft.name.trim() === "" ? [{ path: ["name"], message: "An applet needs a name" }] : [];
		for (const component of ["inputs", "modifiers", "outputs"] as const) {
			for (const [index, slot] of draft.definition[component].entries()) {
				const path = [component, index];
				const schema = plugins.get(slot.plugin)?.instanceSettings[component];
				if (!schema) {
					issues.push({ path, message: `${slot.plugin} is not a plugin for ${component}` });
					continue;
				}
				const parsed = schema.safeParse(slot.settings);
				if (!parsed.success) issues.push(...issuesOf(parsed.error, [...path, "settings"]));
			}
		}
		return issues;
	};

	const save = (id: string, draft: AppletDraft): SaveResult<Applet> => {
		const issues = checkDraft(draft);
		if (issues.length > 0) return { ok: false, issues };
		const existing = applets.get(id);
		const listing: AppletListing = {
			...neverRun,
			schedule: null,
			hasWebhook: false,
			...existing,
			...structuredClone(draft),
			id,
		};
		applets.set(id, listing);
		return { ok: true, value: appletOf(listing) };
	};

	const existing = (id: string): AppletListing => {
		const applet = applets.get(id);
		if (!applet) throw new Error(`No applet ${id}`);
		return applet;
	};

	return {
		instance: async () => ({ exposed: seed.exposed ?? false }),
		plugins: async () => structuredClone(catalogue),
		applets: {
			list: async () => structuredClone([...applets.values()]),
			get: async (id) => appletOf(existing(id)),
			create: async (draft) => save(`applet-${nextId++}`, draft),
			update: async (id, draft) => save(existing(id).id, draft),
			delete: async (id) => {
				applets.delete(id);
				for (const run of runs.values()) if (run.appletId === id) runs.delete(run.id);
			},
			runNow: async (id) => runNow(existing(id)),
		},
		triggers: {
			setSchedule: async (appletId, schedule) => {
				const applet = existing(appletId);
				applet.schedule = schedule ? structuredClone(schedule) : null;
				return { ok: true, value: appletOf(applet) };
			},
			generateWebhook: async (appletId) => {
				existing(appletId).hasWebhook = true;
				return { url: `/hooks/${appletId}/${crypto.randomUUID()}` };
			},
			removeWebhook: async (appletId) => {
				existing(appletId).hasWebhook = false;
			},
		},
		runs: {
			get: async (id) => {
				const run = runs.get(id);
				if (!run) throw new Error(`No run ${id}`);
				return structuredClone(run);
			},
			events: (id) => script(id).follow(),
		},
		scripts: {
			advance: (runId, count) => script(runId).advance(count),
			drop: (runId) => script(runId).drop(),
			connections: (runId) => script(runId).connections,
		},
		settings: {
			get: async (plugin) => {
				const value = settings.get(plugin) ?? {};
				const parsed = plugins.get(plugin)?.persistentSettings?.safeParse(value);
				return {
					value: structuredClone(value),
					issues: parsed?.success === false ? issuesOf(parsed.error) : [],
				};
			},
			save: async (plugin, value) => {
				const schema = plugins.get(plugin)?.persistentSettings;
				if (!schema)
					return { ok: false, issues: [{ path: [], message: `${plugin} has no settings` }] };
				const parsed = schema.safeParse(value);
				if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
				settings.set(plugin, structuredClone(value));
				return { ok: true, value };
			},
		},
		services: {
			list: async () => {
				const used = new Map<Service, ServiceStatus>();
				for (const plugin of seed.plugins) {
					if (!plugin.auth) continue;
					const { service, flow } = plugin.auth;
					const status = used.get(service) ?? {
						service,
						flow,
						status: grants.get(service) ?? { kind: "not-connected" },
						usedBy: [],
					};
					status.usedBy.push(plugin.name);
					used.set(service, status);
				}
				return structuredClone([...used.values()]);
			},
			requirements: async (service): Promise<AuthRequirement[]> => {
				const spec = authSpec(service);
				if (spec.flow === "token") {
					const fields = formSchema(spec.fields, { auth: true });
					return Object.keys(fields.properties ?? {}).length === 0
						? []
						: [{ kind: "fields", schema: fields }];
				}
				if (spec.flow === "none") return [];
				return seed.unregisteredClients?.includes(service)
					? [{ kind: "client", service }, { kind: "connect" }]
					: [{ kind: "connect" }];
			},
			redirectUri: async (service) => `http://localhost:5173/services/${service}`,
			configure: async (service, input) => {
				const parsed = authSpec(service).fields.safeParse(input);
				if (!parsed.success) return { kind: "invalid", issues: issuesOf(parsed.error) };
				const failure = seed.testFailures?.[service];
				if (failure) return { kind: "test-failed", message: failure };
				grants.set(service, { kind: "connected" });
				return { kind: "saved" };
			},
			begin: async (service) => ({ authoriseUrl: `/services/${service}?code=fake-${service}` }),
			outcome: async (service, callback) => {
				if (callback.code !== `fake-${service}`) {
					return { kind: "failed", message: callback.error ?? "the service sent no code" };
				}
				grants.set(service, { kind: "connected" });
				return { kind: "connected" };
			},
		},
	};
}

function appletOf({ id, name, enabled, definition, schedule, hasWebhook }: Applet): Applet {
	return structuredClone({ id, name, enabled, definition, schedule, hasWebhook });
}
