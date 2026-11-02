import type { FinishedRunStatus, RunEvent } from "@ultrasonics/core/run-events";
import type {
	AuthChallenge,
	AuthFailure,
	AuthRequirement,
	Component,
	Flow,
	JSONSchema,
	Mode,
	Service,
	ValidationIssue,
} from "@ultrasonics/plugin-sdk";
import { type InjectionKey, inject } from "vue";

// View types are web-local until the server spec fixes its schemas; the HTTP client reconciles them.

export interface InstanceInfo {
	/** Reachable from a public address while the session source is `bootstrapped` (ADR-0015 §6). */
	exposed: boolean;
}

export interface PluginInfo {
	name: string;
	description: string;
	version: string;
	components: Component[];
	mode: Mode[];
	service?: Service;
	/** Form JSON Schema from `toFormSchema`; absent when the plugin has no persistent settings. */
	persistentSettings?: JSONSchema;
	instanceSettings: Partial<Record<Component, JSONSchema>>;
}

export interface Slot {
	plugin: string;
	settings: unknown;
}

export interface AppletDefinition {
	inputs: Slot[];
	modifiers: Slot[];
	outputs: Slot[];
}

/** ADR-0018 §1: every `count` `unit`s from a local `anchor`, in an IANA zone. */
export interface Schedule {
	kind: "interval";
	unit: "hour" | "day" | "week";
	count: number;
	/** A local date-time without a zone, as `2026-11-01T07:00:00`. */
	anchor: string;
	timeZone: string;
}

export interface AppletDraft {
	name: string;
	enabled: boolean;
	definition: AppletDefinition;
}

export interface Applet extends AppletDraft {
	id: string;
	schedule: Schedule | null;
	hasWebhook: boolean;
}

export type RunStatus = "running" | FinishedRunStatus;
export type RunTrigger = "schedule" | "webhook" | "manual";

export interface AppletListing extends Applet {
	state: "idle" | "running" | "queued";
	lastRun: { id: string; status: RunStatus; at: number } | null;
	/** Epoch milliseconds; null when nothing schedules the applet. */
	nextRunAt: number | null;
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export type RunNowResult = { kind: "started"; runId: string } | { kind: "queued" };

export interface RunSummary {
	id: string;
	appletId: string;
	trigger: RunTrigger;
	status: RunStatus;
	startedAt: number;
	finishedAt: number | null;
}

export interface StoredSettings {
	value: unknown;
	/** What the stored value fails today, as after a plugin update (ADR-0019 §7). */
	issues: ValidationIssue[];
}

export interface ServiceStatus {
	service: Service;
	flow: Flow;
	status:
		| { kind: "connected" }
		| { kind: "not-connected" }
		| { kind: "failed"; failure: AuthFailure };
	/** Names of the plugins that declare this service. */
	usedBy: string[];
}

export type ConfigureResult =
	| { kind: "saved" }
	| { kind: "invalid"; issues: ValidationIssue[] }
	| { kind: "test-failed"; message: string };

export type ConnectOutcome = { kind: "connected" } | { kind: "failed"; message: string };

/** Every server call the screens make. Screens never call `fetch` or `EventSource` themselves. */
export interface ApiClient {
	instance(): Promise<InstanceInfo>;
	plugins(): Promise<PluginInfo[]>;
	applets: {
		list(): Promise<AppletListing[]>;
		get(id: string): Promise<Applet>;
		create(draft: AppletDraft): Promise<SaveResult<Applet>>;
		update(id: string, draft: AppletDraft): Promise<SaveResult<Applet>>;
		/** Deletes the applet and its runs. */
		delete(id: string): Promise<void>;
		runNow(id: string): Promise<RunNowResult>;
	};
	triggers: {
		/** `null` clears the schedule. */
		setSchedule(appletId: string, schedule: Schedule | null): Promise<SaveResult<Applet>>;
		/** Replaces any existing token; the URL carries the token and is never returned again. */
		generateWebhook(appletId: string): Promise<{ url: string }>;
		removeWebhook(appletId: string): Promise<void>;
	};
	runs: {
		get(id: string): Promise<RunSummary>;
		/** Replays from the first event, follows live, resumes after a drop, and ends after `end`. */
		events(id: string): AsyncIterable<RunEvent>;
	};
	settings: {
		get(plugin: string): Promise<StoredSettings>;
		save(plugin: string, value: unknown): Promise<SaveResult<unknown>>;
	};
	services: {
		list(): Promise<ServiceStatus[]>;
		requirements(service: Service): Promise<AuthRequirement[]>;
		/** Open question 3 of spec #118: which server operation supplies this is undecided. */
		redirectUri(service: Service): Promise<string>;
		/**
		 * The form for a `client` requirement, and saving the operator's client credentials. Open
		 * question 2 of spec #118: `AuthRequirement` carries no schema for it yet.
		 */
		clientForm(service: Service): Promise<JSONSchema>;
		registerClient(service: Service, input: unknown): Promise<SaveResult<null>>;
		configure(service: Service, input: unknown): Promise<ConfigureResult>;
		begin(service: Service): Promise<AuthChallenge>;
		/** Reads back the outcome of the OAuth return, from the query the wizard's route received. */
		outcome(service: Service, callback: Record<string, string>): Promise<ConnectOutcome>;
	};
}

export const apiKey: InjectionKey<ApiClient> = Symbol("ApiClient");

export function useApi(): ApiClient {
	const api = inject(apiKey);
	if (!api) throw new Error("No ApiClient provided at the app root");
	return api;
}
