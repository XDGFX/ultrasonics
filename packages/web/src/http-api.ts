import { RunEvent } from "@ultrasonics/core/run-events";
import {
	Applet,
	AppletListing,
	AuthChallenge,
	AuthRequirement,
	ConfigureResult,
	ConnectOutcome,
	ErrorBody,
	InstanceInfo,
	IssuesBody,
	JsonSchema,
	PluginInfo,
	RedirectUri,
	RunNowResult,
	RunSummary,
	ServiceStatus,
	StoredSettings,
	WebhookUrl,
} from "@ultrasonics/server/api";
import { z } from "zod";
import { type ApiClient, ApiError, RunStreamError, type SaveResult } from "./api-client.ts";

/** The part of the browser's `EventSource` the run stream uses, so tests can pass another. */
export interface EventSourceLike {
	readonly readyState: number;
	onmessage: ((event: MessageEvent<string>) => void) | null;
	onerror: ((event: Event) => void) | null;
	close(): void;
}

export interface HttpApiOptions {
	/** Where the API lives: the page's own origin in the app. */
	origin: string;
	/** The browser's `EventSource` in the app; tests pass another. */
	EventSource: new (
		url: string,
	) => EventSourceLike;
	fetch?: typeof fetch;
}

/** `EventSource.CLOSED`: the browser has given up and won't reconnect, as after a `404`. */
const CLOSED = 2;

/** A path under `/api`, with each interpolated value encoded as one segment. */
function route(strings: TemplateStringsArray, ...segments: string[]): string {
	return strings.reduce(
		(path, text, index) => `${path}${encodeURIComponent(segments[index - 1] ?? "")}${text}`,
	);
}

/** One SSE message's `data`: a run event as JSON. */
const RunEventData = z
	.string()
	.transform((data, ctx) => {
		try {
			return JSON.parse(data) as unknown;
		} catch {
			ctx.addIssue({ code: "custom", message: "not JSON" });
			return z.NEVER;
		}
	})
	.pipe(RunEvent);

/**
 * The `ApiClient` over the server's routes (spec #134), parsing every reply with
 * `@ultrasonics/server/api`'s schemas.
 */
export function createHttpApi(options: HttpApiOptions): ApiClient {
	const { origin, EventSource: Source } = options;
	const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
	const url = (path: string) => new URL(`/api${path}`, origin).toString();

	async function send(method: string, path: string, body?: unknown): Promise<Response> {
		const headers: Record<string, string> = { Accept: "application/json" };
		// Every mutation is JSON, even without a body, or the server answers `415` (ADR-0030).
		if (method !== "GET") headers["Content-Type"] = "application/json";
		return fetcher(url(path), {
			method,
			headers,
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}

	async function failure(response: Response): Promise<ApiError> {
		const body = ErrorBody.safeParse(await response.json().catch(() => undefined));
		return new ApiError(
			response.status,
			body.success ? body.data.message : `The server answered ${response.status}`,
		);
	}

	/** The reply's body as `schema` accepts it; a `204`'s is `null`. */
	async function parsed<T extends z.ZodType>(response: Response, schema: T): Promise<z.output<T>> {
		const body = response.status === 204 ? null : await response.json().catch(() => undefined);
		const result = schema.safeParse(body);
		if (!result.success) {
			throw new ApiError(response.status, `The server's reply to ${response.url} was malformed`);
		}
		return result.data;
	}

	/** A call whose only success is `2xx` with a body `schema` accepts. */
	async function read<T extends z.ZodType>(
		schema: T,
		method: string,
		path: string,
		body?: unknown,
	): Promise<z.output<T>> {
		const response = await send(method, path, body);
		if (!response.ok) throw await failure(response);
		return parsed(response, schema);
	}

	/** A call answering `204`. */
	async function act(method: string, path: string): Promise<void> {
		const response = await send(method, path);
		if (!response.ok) throw await failure(response);
	}

	/** A save: `2xx` with what `schema` accepts, or `422` with issues by path. */
	async function save<T extends z.ZodType>(
		schema: T,
		method: string,
		path: string,
		body: unknown,
	): Promise<SaveResult<z.output<T>>> {
		const response = await send(method, path, body);
		if (response.status === 422) {
			return { ok: false, issues: (await parsed(response, IssuesBody)).issues };
		}
		if (!response.ok) throw await failure(response);
		return { ok: true, value: await parsed(response, schema) };
	}

	async function* events(id: string, signal?: AbortSignal): AsyncIterable<RunEvent> {
		if (signal?.aborted) return;
		// The browser reconnects by itself after a drop, sending the last `id` it saw as
		// `Last-Event-ID`, and the server resumes after it (ADR-0026 §3).
		const source = new Source(url(route`/runs/${id}/events`));
		const pending: RunEvent[] = [];
		let failed: RunStreamError | undefined;
		let wake: (() => void) | undefined;
		const notify = () => {
			wake?.();
			wake = undefined;
		};
		source.onmessage = (message) => {
			if (failed) return;
			const event = RunEventData.safeParse(message.data);
			if (event.success) pending.push(event.data);
			else {
				failed = new RunStreamError("malformed", `Run ${id} sent an event that isn't a run event`);
				source.close();
			}
			notify();
		};
		source.onerror = () => {
			// While it's reconnecting, the drop is the browser's to repair.
			if (source.readyState !== CLOSED) return;
			failed = new RunStreamError("closed", `The event stream of run ${id} closed before its end`);
			notify();
		};
		signal?.addEventListener("abort", notify, { once: true });
		let lastSeq = 0;
		try {
			while (!signal?.aborted) {
				const event = pending.shift();
				if (!event) {
					if (failed) throw failed;
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					continue;
				}
				// A resume replays after the last id the browser saw, so this only guards a repeat.
				if (event.seq <= lastSeq) continue;
				lastSeq = event.seq;
				yield event;
				if (event.type === "end") return;
			}
		} finally {
			source.close();
			signal?.removeEventListener("abort", notify);
		}
	}

	return {
		instance: () => read(InstanceInfo, "GET", "/instance"),
		plugins: () => read(z.array(PluginInfo), "GET", "/plugins"),
		applets: {
			list: () => read(z.array(AppletListing), "GET", "/applets"),
			get: (id) => read(Applet, "GET", route`/applets/${id}`),
			create: (draft) => save(Applet, "POST", "/applets", draft),
			update: (id, draft) => save(Applet, "PUT", route`/applets/${id}`, draft),
			delete: (id) => act("DELETE", route`/applets/${id}`),
			runNow: (id) => read(RunNowResult, "POST", route`/applets/${id}/run`),
		},
		triggers: {
			setSchedule: (id, schedule) => save(Applet, "PUT", route`/applets/${id}/schedule`, schedule),
			generateWebhook: (id) => read(WebhookUrl, "POST", route`/applets/${id}/webhook`),
			removeWebhook: (id) => act("DELETE", route`/applets/${id}/webhook`),
		},
		runs: {
			get: (id) => read(RunSummary, "GET", route`/runs/${id}`),
			events,
		},
		settings: {
			get: (plugin) => read(StoredSettings, "GET", route`/settings/${plugin}`),
			save: (plugin, value) => save(z.unknown(), "PUT", route`/settings/${plugin}`, value),
		},
		services: {
			list: () => read(z.array(ServiceStatus), "GET", "/services"),
			requirements: (service) =>
				read(z.array(AuthRequirement), "GET", route`/services/${service}/requirements`),
			redirectUri: async (service) =>
				(await read(RedirectUri, "GET", route`/services/${service}/redirect-uri`)).redirectUri,
			clientForm: (service) => read(JsonSchema, "GET", route`/services/${service}/client-form`),
			registerClient: (service, input) =>
				save(z.null(), "PUT", route`/services/${service}/client`, input),
			configure: async (service, input) => {
				// `invalid` comes as a `422`; `saved` and `test-failed` as a `200`.
				const response = await send("POST", route`/services/${service}/configure`, input);
				if (!response.ok && response.status !== 422) throw await failure(response);
				return parsed(response, ConfigureResult);
			},
			begin: (service) => read(AuthChallenge, "POST", route`/services/${service}/begin`),
			outcome: (service, callback) =>
				read(ConnectOutcome, "POST", route`/services/${service}/complete`, callback),
		},
	};
}
