import { describe, expect, test } from "bun:test";
import {
	type AuthFailure,
	type AuthProvider,
	type HostPort,
	type LogEntry,
	type RunPayload,
	SongDict,
	type SongDictInput,
} from "@ultrasonics/plugin-sdk";
import { type Act, songs } from "../test/worker-plugins/probe.ts";
import { InProcessExecutor, type RegistryEntry } from "./plugin-executor.ts";
import type { RunEvent } from "./run-event.ts";
import { runApplet } from "./runner.ts";
import { WorkerExecutor } from "./worker-executor.ts";

const probePath = new URL("../test/worker-plugins/probe.ts", import.meta.url).href;
const probe: RegistryEntry = { path: probePath, load: () => import(probePath) };

const fields = {
	appletId: "applet-1",
	runId: "run-1",
	deadlineMs: Date.now() + 60_000,
	configDir: "/config/probe",
	persistent: {},
};

const input = (act: Act, count = 1): RunPayload => ({
	...fields,
	component: "inputs",
	instance: { act, count },
});

const output = (songs: SongDictInput): RunPayload => ({
	...fields,
	component: "outputs",
	instance: {},
	songs: SongDict.parse(songs),
});

/** A host port answering with `credentials`, or rejecting with `rejects`, and keeping each log line. */
function host(answer: { credentials?: unknown; rejects?: unknown } = {}) {
	const lines: LogEntry[] = [];
	const port: HostPort = {
		credentials: () =>
			"rejects" in answer ? Promise.reject(answer.rejects) : Promise.resolve(answer.credentials),
		log: (entry) => lines.push(entry),
	};
	return { port, lines };
}

describe("WorkerExecutor: what crosses back", () => {
	test("an input's 10,000-song dict equals what the in-process executor returns", async () => {
		const payload = input("songs", 10_000);

		const inWorker = await new WorkerExecutor().run(probe, payload, host().port);
		const inProcess = await new InProcessExecutor().run(probe, payload, host().port);

		expect(inWorker.ok && (inWorker.value as SongDictInput).playlists[0]?.songs).toHaveLength(
			10_000,
		);
		expect(inWorker).toEqual(inProcess);
	});

	test("an output's result equals what the in-process executor returns", async () => {
		const payload = output(songs(3));

		const inWorker = await new WorkerExecutor().run(probe, payload, host().port);
		const inProcess = await new InProcessExecutor().run(probe, payload, host().port);

		expect(inWorker).toEqual({
			ok: true,
			value: { playlists: [{ status: "written", playlist: 0, unmatched: [] }] },
		});
		expect(inWorker).toEqual(inProcess);
	});
});

describe("WorkerExecutor: a plugin that breaks fails only its own call", () => {
	const executor = new WorkerExecutor();
	const missingHandler: RunPayload = {
		...fields,
		component: "modifiers",
		instance: {},
		songs: SongDict.parse({ playlists: [] }),
	};

	test.each<[string, RunPayload, string]>([
		["a handler throw", input("throw"), "the probe threw"],
		["a floating rejection", input("floating-rejection"), "the probe rejected in the background"],
		["process.exit()", input("exit"), "code 7"],
		["a missing handler", missingHandler, "No modifiers handler"],
		["a message that fails its schema", input("post-garbage"), "gibberish"],
	])("%s settles as a failure saying so, and the next call succeeds", async (_, payload, says) => {
		const failed = await executor.run(probe, payload, host().port);
		const next = await executor.run(probe, input("songs"), host().port);

		expect(failed.ok).toBe(false);
		expect(!failed.ok && failed.message).toContain(says);
		expect(next).toEqual({ ok: true, value: songs(1) });
	});
});

describe("WorkerExecutor: the host port", () => {
	test("credentials() resolves through the host", async () => {
		const result = await new WorkerExecutor().run(
			probe,
			input("credentials"),
			host({ credentials: { token: "secret" } }).port,
		);

		expect(result).toEqual({ ok: true, value: { playlists: [{ name: "secret", songs: [] }] } });
	});

	test("an AuthFailure rejection reaches the plugin as the same plain object", async () => {
		const failure: AuthFailure = { service: "plex", code: "reconnect", message: "Token revoked" };

		const result = await new WorkerExecutor().run(
			probe,
			input("catch-credentials"),
			host({ rejects: failure }).port,
		);

		expect(result).toEqual({ ok: true, value: { caught: failure } });
	});

	test("an Error rejection reaches the plugin with its message", async () => {
		const result = await new WorkerExecutor().run(
			probe,
			input("catch-credentials"),
			host({ rejects: new Error("declares no service auth") }).port,
		);

		expect(result.ok && (result.value as { caught: Error }).caught.message).toBe(
			"declares no service auth",
		);
	});

	test("a credentials answer that cannot cross the boundary fails the call", async () => {
		const result = await new WorkerExecutor().run(
			probe,
			input("catch-credentials"),
			host({ rejects: { retry: () => {} } }).port,
		);

		expect(result.ok).toBe(false);
	});

	test("log lines arrive with their level and run", async () => {
		const { port, lines } = host();

		await new WorkerExecutor().run(probe, input("log"), port);

		expect(lines).toEqual([
			{ runId: "run-1", level: "debug", message: "quiet" },
			{ runId: "run-1", level: "warn", message: "loud" },
		]);
	});
});

describe("WorkerExecutor: through runApplet", () => {
	async function runProbe(act: Act, auth: AuthProvider["resolve"]) {
		const events: RunEvent[] = [];
		const unused = () => Promise.reject(new Error("not used by the runner"));
		const status = await runApplet({
			runId: "run-1",
			applet: {
				id: "applet-1",
				name: "Probe",
				definition: {
					inputs: [{ plugin: "probe", settings: { act } }],
					modifiers: [],
					outputs: [{ plugin: "probe", settings: {} }],
				},
			},
			trigger: "manual",
			registry: { probe },
			executor: new WorkerExecutor(),
			capabilities: {
				auth: {
					requirements: () => [],
					resolve: auth,
					configure: unused,
					begin: unused,
					complete: unused,
				},
				persistentSettings: async () => undefined,
				configDir: (plugin) => `/config/${plugin}`,
			},
			events: { emit: (event) => events.push(event) },
		});
		return { status, events };
	}

	test("log lines reach the run attributed to the plugin, at their level", async () => {
		const { status, events } = await runProbe("log", async () => ({ token: "secret" }));

		expect(status).toBe("succeeded");
		expect(events).toContainEqual(
			expect.objectContaining({ type: "log", source: "probe", level: "warn", text: "loud" }),
		);
	});

	test("an AuthFailure the plugin rethrows reaches the stage with its own code", async () => {
		const failure: AuthFailure = { service: "plex", code: "reconnect", message: "Token revoked" };

		const { status, events } = await runProbe("credentials", () => Promise.reject(failure));

		expect(status).toBe("failed");
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "stage",
				state: "finished",
				error: expect.objectContaining({ code: "reconnect", auth: failure }),
			}),
		);
	});
});
