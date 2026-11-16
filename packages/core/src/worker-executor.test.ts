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
import { type Act, PAUSE_MS, STARTED, songs } from "../test/worker-plugins/probe.ts";
import { InProcessExecutor, type RegistryEntry } from "./plugin-executor.ts";
import type { RunEvent } from "./run-event.ts";
import { RUN_DEADLINE_MS, runApplet } from "./runner.ts";
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

/** The payload with its deadline `inMs` from now; negative for one already passed. */
const due = (payload: RunPayload, inMs: number): RunPayload => ({
	...payload,
	deadlineMs: Date.now() + inMs,
});

/** How late past its deadline a call may settle, and how late a host timer may fire meanwhile. */
const TOLERANCE_MS = 100;

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
	const signedIn = async () => ({ token: "secret" });

	/** Runs the probe as one input and the given outputs, with the run's deadline `deadlineInMs` away. */
	async function runProbe(
		act: Act,
		auth: AuthProvider["resolve"],
		{ outputs = ["write"], deadlineInMs = RUN_DEADLINE_MS } = {} as {
			outputs?: ("write" | "hang")[];
			deadlineInMs?: number;
		},
	) {
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
					outputs: outputs.map((act) => ({ plugin: "probe", settings: { act } })),
				},
			},
			trigger: "manual",
			registry: { probe },
			executor: new WorkerExecutor(),
			// The runner sets its deadline from this clock; the executor keeps to the real one.
			now: () => Date.now() - RUN_DEADLINE_MS + deadlineInMs,
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
		const { status, events } = await runProbe("log", signedIn);

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

	const timedOut = {
		code: "timed-out" as const,
		message: expect.stringContaining(`${RUN_DEADLINE_MS / 60_000}-minute deadline`),
	};
	const finished = (events: RunEvent[]) =>
		events.flatMap((event) =>
			event.type === "stage" && event.state === "finished" ? [event] : [],
		);

	test("a hanging input ends the run failed with a timed-out stage error", async () => {
		const { status, events } = await runProbe("hang", signedIn, { deadlineInMs: 200 });

		expect(status).toBe("failed");
		expect(finished(events)).toEqual([
			expect.objectContaining({ component: "inputs", error: timedOut }),
		]);
	});

	test("an output after a timed-out stage times out at once", async () => {
		const { status, events } = await runProbe("songs", signedIn, {
			outputs: ["hang", "write"],
			deadlineInMs: 300,
		});
		const second = events.filter(
			(event) => event.type === "stage" && event.component === "outputs" && event.index === 1,
		);

		expect(status).toBe("failed");
		expect(finished(events).map((event) => event.error)).toEqual([undefined, timedOut, timedOut]);
		expect((second[1]?.at ?? Infinity) - (second[0]?.at ?? 0)).toBeLessThan(TOLERANCE_MS);
	});
});

describe("WorkerExecutor: the deadline", () => {
	test("a plugin spinning in while (true) times out at its deadline, and the host stays responsive", async () => {
		const payload = due(input("spin"), 300);
		let settled = false;
		const lags: number[] = [];

		const call = new WorkerExecutor().run(probe, payload, host().port).finally(() => {
			settled = true;
		});
		while (!settled) {
			const asked = performance.now();
			await new Promise((resolve) => setTimeout(resolve, 0));
			lags.push(performance.now() - asked);
		}
		const result = await call;
		const late = Date.now() - payload.deadlineMs;

		expect(result).toMatchObject({ ok: false, timedOut: true });
		expect(late).toBeGreaterThanOrEqual(0);
		expect(late).toBeLessThan(TOLERANCE_MS);
		expect(Math.max(...lags)).toBeLessThan(TOLERANCE_MS);
	});

	test("a call whose deadline has already passed times out without starting the plugin", async () => {
		const { port, lines } = host();

		const result = await new WorkerExecutor().run(probe, due(input("pause"), -1), port);
		await Bun.sleep(PAUSE_MS * 2);

		expect(result).toMatchObject({ ok: false, timedOut: true });
		expect(lines).toEqual([]);
	});

	test("once a call has timed out, nothing its worker sends reaches the host", async () => {
		const { port, lines } = host();

		const result = await new WorkerExecutor().run(probe, due(input("log-late"), 100), port);
		const atSettle = lines.length;
		await Bun.sleep(100);

		expect(result).toMatchObject({ ok: false, timedOut: true });
		expect(atSettle).toBeGreaterThan(0);
		expect(lines).toHaveLength(atSettle);
	});
});

describe("WorkerExecutor: the worker cap", () => {
	/** Calls the probe, recording the order calls start in and the most running at once. */
	function tracker(executor: WorkerExecutor) {
		let running = 0;
		let most = 0;
		const order: string[] = [];
		const call = async (name: string, payload: RunPayload) => {
			const port: HostPort = {
				credentials: () => Promise.reject(new Error("not used")),
				log: (entry) => {
					if (entry.message !== STARTED) return;
					order.push(name);
					most = Math.max(most, ++running);
				},
			};
			const result = await executor.run(probe, payload, port);
			if (order.includes(name)) running--;
			return result;
		};
		return { call, order, most: () => most };
	}

	test("with a cap of 2, five calls never run more than two workers at once", async () => {
		const { call, most } = tracker(new WorkerExecutor({ cap: 2 }));

		const results = await Promise.all(
			["a", "b", "c", "d", "e"].map((n) => call(n, input("pause"))),
		);

		expect(results).toEqual(Array(5).fill({ ok: true, value: songs(1) }));
		expect(most()).toBe(2);
	});

	test("waiting calls take freed slots in the order they arrived", async () => {
		const { call, order } = tracker(new WorkerExecutor({ cap: 2 }));

		const [, hung] = await Promise.all([
			call("a", input("pause")),
			call("b", due(input("hang"), 400)),
			call("c", input("pause")),
			call("d", input("pause")),
		]);

		expect(hung).toMatchObject({ ok: false, timedOut: true });
		expect(order).toEqual(["a", "c", "d"]);
	});

	test("a slot frees as soon as its call times out", async () => {
		const { call, order } = tracker(new WorkerExecutor({ cap: 1 }));

		const [spun, next] = await Promise.all([
			call("spin", due(input("spin"), 100)),
			call("next", input("pause")),
		]);

		expect(spun).toMatchObject({ ok: false, timedOut: true });
		expect(next).toEqual({ ok: true, value: songs(1) });
		expect(order).toEqual(["next"]);
	});

	test("a call whose deadline passes while it waits times out without starting", async () => {
		const { call, order } = tracker(new WorkerExecutor({ cap: 1 }));
		const settled: string[] = [];
		const noting = (name: string, payload: RunPayload) =>
			call(name, payload).finally(() => settled.push(name));

		const [, waited] = await Promise.all([
			noting("holder", due(input("hang"), 300)),
			noting("waiter", due(input("pause"), 50)),
		]);
		await Bun.sleep(PAUSE_MS * 2);

		expect(waited).toMatchObject({ ok: false, timedOut: true });
		expect(settled).toEqual(["waiter", "holder"]);
		expect(order).toEqual([]);
	});
});
