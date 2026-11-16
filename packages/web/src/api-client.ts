import type { RunEvent } from "@ultrasonics/core/run-events";
import type { JSONSchema, Service } from "@ultrasonics/plugin-sdk";
import type {
	Applet,
	AppletDefinition,
	AppletDraft,
	AppletListing,
	AuthChallenge,
	AuthRequirement,
	ConfigureResult,
	ConnectOutcome,
	InstanceInfo,
	PluginInfo,
	RunNowResult,
	RunStatus,
	RunSummary,
	RunTrigger,
	Schedule,
	ServiceStatus,
	Slot,
	StoredSettings,
	ValidationIssue,
	WebhookUrl,
} from "@ultrasonics/server/api";
import { type InjectionKey, inject } from "vue";

// The wire types are the server's: `z.infer` of `@ultrasonics/server/api`.
export type {
	Applet,
	AppletDefinition,
	AppletDraft,
	AppletListing,
	ConfigureResult,
	ConnectOutcome,
	InstanceInfo,
	PluginInfo,
	RunNowResult,
	RunStatus,
	RunSummary,
	RunTrigger,
	Schedule,
	ServiceStatus,
	Slot,
	StoredSettings,
};

/** A save's answer as the screens take it: the saved value, or the server's `422` issues. */
export type SaveResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

/** A response the UI didn't expect: the server's `{ message }`, or what was wrong with the reply. */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/** A run's event stream that stopped before the run's `end`, or sent something that isn't an event. */
export class RunStreamError extends Error {
	constructor(
		readonly reason: "closed" | "malformed",
		message: string,
	) {
		super(message);
		this.name = "RunStreamError";
	}
}

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
		generateWebhook(appletId: string): Promise<WebhookUrl>;
		removeWebhook(appletId: string): Promise<void>;
	};
	runs: {
		get(id: string): Promise<RunSummary>;
		/** Replays from the first event, follows live, resumes after a drop, and ends after `end` or on abort. */
		events(id: string, signal?: AbortSignal): AsyncIterable<RunEvent>;
	};
	settings: {
		get(plugin: string): Promise<StoredSettings>;
		save(plugin: string, value: unknown): Promise<SaveResult<unknown>>;
	};
	services: {
		list(): Promise<ServiceStatus[]>;
		requirements(service: Service): Promise<AuthRequirement[]>;
		/** The URI to register with the service; the provider chooses it from the wizard's origin. */
		redirectUri(service: Service): Promise<string>;
		/** The provider's fixed form for a `client` requirement, and saving the operator's client. */
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
