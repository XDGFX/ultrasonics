import { describe, expect, test } from "bun:test";
import type { RunEvent } from "@ultrasonics/core/run-events";
import { GOOD_TOKEN, useContractServer } from "../test/contract-server.ts";
import { type ApiClient, ApiError, type AppletDraft, RunStreamError } from "./api-client.ts";
import { EXAMPLE_CLIENT_ID } from "./fake-api.ts";
import { createHttpApi, type EventSourceLike } from "./http-api.ts";

const serve = useContractServer();

async function client() {
	const { origin, EventSource } = await serve();
	return { api: createHttpApi({ origin, EventSource }), origin, EventSource };
}

async function createApplet(api: ApiClient) {
	const created = await api.applets.create(draft);
	if (!created.ok) throw new Error("create refused");
	return created.value;
}

/** Runs the draft now and returns its id once its stream has ended. */
async function finishedRun(api: ApiClient): Promise<string> {
	await api.settings.save("source", { region: "au" });
	const started = await api.applets.runNow((await createApplet(api)).id);
	if (started.kind !== "started") throw new Error("the run was queued");
	await collect(api.runs.events(started.runId));
	return started.runId;
}

/**
 * A `fetch` for the run stream that cuts the first connection after `count` events, with a short
 * reconnect delay, recording the `Last-Event-ID` each connection sends.
 */
function droppingAfter(count: number, lastEventIds: (string | null)[]) {
	return async (input: string | URL, init?: RequestInit): Promise<Response> => {
		lastEventIds.push(new Headers(init?.headers).get("Last-Event-ID"));
		const response = await fetch(input, init);
		if (lastEventIds.length > 1 || !response.body) return response;
		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		const encoder = new TextEncoder();
		let buffer = "";
		let sent = 0;
		let cut = false;
		const body = new ReadableStream<Uint8Array>({
			start: (controller) => controller.enqueue(encoder.encode("retry: 10\n\n")),
			async pull(controller) {
				// Erroring drops whatever is still queued, so the drop waits until the reader has it all.
				if (cut) return controller.error(new Error("dropped"));
				for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
					const message = buffer.slice(0, end + 2);
					buffer = buffer.slice(end + 2);
					if (/^id:/m.test(message) && sent === count) {
						cut = true;
						void reader.cancel();
						return;
					}
					if (/^id:/m.test(message)) sent++;
					controller.enqueue(encoder.encode(message));
				}
				const { value, done } = await reader.read();
				if (done) controller.close();
				else buffer += value;
			},
		});
		return new Response(body, { status: response.status, headers: response.headers });
	};
}

const draft: AppletDraft = {
	name: "mix to sink",
	enabled: true,
	definition: {
		inputs: [{ plugin: "source", settings: { count: 3 } }],
		modifiers: [],
		outputs: [{ plugin: "sink", settings: {} }],
	},
};

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
	const seen: RunEvent[] = [];
	for await (const event of events) seen.push(event);
	return seen;
}

describe("the HTTP client against the real server", () => {
	test("reads the instance and the plugin catalogue", async () => {
		const { api } = await client();
		expect(await api.instance()).toEqual({ exposed: false });
		const plugins = await api.plugins();
		expect(plugins.map((plugin) => plugin.name).sort()).toEqual([
			"plex",
			"sink",
			"source",
			"spotify",
		]);
		expect(
			plugins.find((plugin) => plugin.name === "source")?.instanceSettings.inputs,
		).toMatchObject({
			type: "object",
		});
	});

	test("creates, reads, updates, lists and deletes an applet, with issues at the builder's paths", async () => {
		const { api } = await client();
		const refused = await api.applets.create({
			...draft,
			name: "",
			definition: { ...draft.definition, inputs: [{ plugin: "source", settings: { count: 0 } }] },
		});
		expect(refused.ok).toBe(false);
		if (refused.ok) return;
		expect(refused.issues.map((issue) => issue.path)).toEqual([
			["name"],
			["inputs", 0, "settings", "count"],
		]);

		const created = await createApplet(api);
		const { id } = created;
		expect(created).toMatchObject({ name: "mix to sink", schedule: null, hasWebhook: false });
		expect(await api.applets.get(id)).toEqual(created);

		const updated = await api.applets.update(id, { ...draft, name: "renamed" });
		expect(updated.ok && updated.value.name).toBe("renamed");
		const [listed] = await api.applets.list();
		expect(listed).toMatchObject({ id, state: "idle", lastRun: null, nextRunAt: null });

		await api.applets.delete(id);
		expect(await api.applets.list()).toEqual([]);
		const missing = await api.applets.get(id).catch((error: unknown) => error);
		expect(missing).toBeInstanceOf(ApiError);
		expect(missing).toMatchObject({ status: 404 });
	});

	test("runs an applet now and follows its events to the end, then replays them the same", async () => {
		const { api } = await client();
		const created = await createApplet(api);
		await api.settings.save("source", { region: "au" });
		const started = await api.applets.runNow(created.id);
		if (started.kind !== "started") throw new Error("the run was queued");

		const live = await collect(api.runs.events(started.runId));
		expect(live.map((event) => event.seq)).toEqual(live.map((_, index) => index + 1));
		expect(live.at(-1)).toMatchObject({ type: "end", status: "succeeded" });
		expect(live.some((event) => event.type === "result")).toBe(true);

		expect(await collect(api.runs.events(started.runId))).toEqual(live);
		expect(await api.runs.get(started.runId)).toMatchObject({
			id: started.runId,
			appletId: created.id,
			trigger: "manual",
			status: "succeeded",
		});
		const [listed] = await api.applets.list();
		expect(listed?.lastRun).toMatchObject({ id: started.runId, status: "succeeded" });
	});

	test("resumes a dropped stream after the last event it saw, sending Last-Event-ID", async () => {
		const { api, origin, EventSource } = await client();
		const runId = await finishedRun(api);
		const lastEventIds: (string | null)[] = [];
		const fetch = droppingAfter(3, lastEventIds);
		class Dropping extends EventSource {
			constructor(url: string) {
				super(url, { fetch });
			}
		}
		const resumed = await collect(
			createHttpApi({ origin, EventSource: Dropping }).runs.events(runId),
		);
		expect(resumed).toEqual(await collect(api.runs.events(runId)));
		expect(lastEventIds).toEqual([null, "3"]);
	});

	test("a run that doesn't exist ends its event stream with an error", async () => {
		const { api } = await client();
		const failure = await collect(api.runs.events("no-such-run")).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(RunStreamError);
		expect(failure).toMatchObject({ reason: "closed" });
	});

	test("sets and clears a schedule, and generates and removes a webhook", async () => {
		const { api, origin } = await client();
		const { id } = await createApplet(api);
		const schedule = {
			kind: "interval",
			unit: "day",
			count: 1,
			anchor: "2026-11-01T07:00:00",
			timeZone: "Australia/Sydney",
		} as const;

		const scheduled = await api.triggers.setSchedule(id, schedule);
		expect(scheduled.ok && scheduled.value.schedule).toEqual(schedule);
		expect((await api.applets.list())[0]?.nextRunAt).toBeGreaterThan(Date.now());
		const refused = await api.triggers.setSchedule(id, { ...schedule, count: 0 });
		expect(refused.ok).toBe(false);
		const cleared = await api.triggers.setSchedule(id, null);
		expect(cleared.ok && cleared.value.schedule).toBeNull();

		const { url } = await api.triggers.generateWebhook(id);
		expect(url).toStartWith(`${origin}/api/hooks/`);
		expect((await api.applets.get(id)).hasWebhook).toBe(true);
		await api.triggers.removeWebhook(id);
		expect((await api.applets.get(id)).hasWebhook).toBe(false);
	});

	test("saves persistent settings, answering issues, and reads them back", async () => {
		const { api } = await client();
		expect(await api.settings.get("source")).toEqual({
			value: {},
			issues: [{ path: ["region"], message: expect.any(String) }],
		});
		const refused = await api.settings.save("source", { region: "nz" });
		expect(refused.ok).toBe(false);
		expect(await api.settings.save("source", { region: "au" })).toEqual({
			ok: true,
			value: { region: "au" },
		});
		expect(await api.settings.get("source")).toEqual({ value: { region: "au" }, issues: [] });
	});

	test("tests and saves a token service: invalid, test failed, then saved", async () => {
		const { api } = await client();
		expect(await api.services.requirements("plex")).toEqual([
			{ kind: "fields", schema: expect.objectContaining({ type: "object" }) },
		]);
		const invalid = await api.services.configure("plex", { url: "http://plex.lan" });
		expect(invalid.kind).toBe("invalid");
		expect(await api.services.configure("plex", { url: "http://plex.lan", token: "bad" })).toEqual({
			kind: "test-failed",
			message: "Plex refused the token",
		});
		expect(
			await api.services.configure("plex", { url: "http://plex.lan", token: GOOD_TOKEN }),
		).toEqual({ kind: "saved" });
		const plex = (await api.services.list()).find((status) => status.service === "plex");
		expect(plex).toEqual({
			service: "plex",
			flow: "token",
			status: { kind: "connected" },
			usedBy: ["plex"],
		});
	});

	test("registers an OAuth client, begins, and reports a refused return", async () => {
		const { api, origin } = await client();
		expect(await api.services.requirements("spotify")).toEqual([
			{ kind: "client", service: "spotify" },
			{ kind: "connect" },
		]);
		const port = new URL(origin).port;
		expect(await api.services.redirectUri("spotify")).toBe(
			`http://127.0.0.1:${port}/services/spotify`,
		);
		expect((await api.services.clientForm("spotify")).properties).toHaveProperty("clientId");
		const refused = await api.services.registerClient("spotify", { clientId: "short" });
		expect(refused.ok).toBe(false);
		expect(
			await api.services.registerClient("spotify", {
				clientId: EXAMPLE_CLIENT_ID,
			}),
		).toEqual({ ok: true, value: null });
		expect(await api.services.requirements("spotify")).toEqual([{ kind: "connect" }]);

		const { authoriseUrl } = await api.services.begin("spotify");
		expect(new URL(authoriseUrl).searchParams.get("code_challenge_method")).toBe("S256");
		expect(await api.services.outcome("spotify", { code: "x", state: "unknown" })).toMatchObject({
			kind: "failed",
		});
	});
});

/** An `EventSource` the test drives by hand, as a browser's would behave. */
function scriptedSource() {
	const opened: ScriptedSource[] = [];
	class ScriptedSource implements EventSourceLike {
		readyState = 0;
		onmessage: ((event: MessageEvent<string>) => void) | null = null;
		onerror: ((event: Event) => void) | null = null;
		closed = false;
		constructor(readonly url: string) {
			opened.push(this);
		}
		send(event: RunEvent) {
			this.readyState = 1;
			this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
		}
		fail(readyState: number) {
			this.readyState = readyState;
			this.onerror?.(new Event("error"));
		}
		close() {
			this.closed = true;
			this.readyState = 2;
		}
	}
	return { opened, ScriptedSource };
}

describe("the run-events iterable", () => {
	const log = (seq: number): RunEvent => ({
		type: "log",
		seq,
		at: seq,
		level: "info",
		source: "runner",
		text: `line ${seq}`,
	});
	const end: RunEvent = { type: "end", seq: 4, at: 4, status: "succeeded" };

	test("rides out a drop the browser repairs, skips a repeat, and closes on end", async () => {
		const { opened, ScriptedSource } = scriptedSource();
		const api = createHttpApi({ origin: "http://music.lan", EventSource: ScriptedSource });
		const events = collect(api.runs.events("run 1"));
		await Bun.sleep(0);
		const [source] = opened;
		if (!source) throw new Error("no stream opened");
		expect(source.url).toBe("http://music.lan/api/runs/run%201/events");
		source.send(log(1));
		source.send(log(2));
		source.fail(0);
		source.send(log(2));
		source.send(log(3));
		source.send(end);
		expect((await events).map((event) => event.seq)).toEqual([1, 2, 3, 4]);
		expect(source.closed).toBe(true);
		expect(opened).toHaveLength(1);
	});

	test("stops and closes the stream on abort", async () => {
		const { opened, ScriptedSource } = scriptedSource();
		const api = createHttpApi({ origin: "http://music.lan", EventSource: ScriptedSource });
		const controller = new AbortController();
		const events = api.runs.events("r", controller.signal)[Symbol.asyncIterator]();
		const first = events.next();
		await Bun.sleep(0);
		opened[0]?.send(log(1));
		expect((await first).value).toMatchObject({ seq: 1 });
		const second = events.next();
		controller.abort();
		expect(await second).toEqual({ done: true, value: undefined });
		expect(opened[0]?.closed).toBe(true);
	});

	test("fails when the browser gives up on the stream", async () => {
		const { opened, ScriptedSource } = scriptedSource();
		const api = createHttpApi({ origin: "http://music.lan", EventSource: ScriptedSource });
		const events = collect(api.runs.events("r"));
		await Bun.sleep(0);
		opened[0]?.send(log(1));
		opened[0]?.fail(2);
		expect(await events.catch((error: unknown) => error)).toMatchObject({ reason: "closed" });
	});
});
