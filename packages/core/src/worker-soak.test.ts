// The CI-sized soak of terminate-mid-`fetch` (research §3–4, scaled down). The full soak runs before
// every Bun upgrade (`docs/build-process.md` § Upgrading Bun); this one catches a regression in CI.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { platform } from "node:os";
import type { HostPort, RunPayload } from "@ultrasonics/plugin-sdk";
import { IN_FETCH } from "../test/worker-plugins/fetch-forever.ts";
import { songs } from "../test/worker-plugins/probe.ts";
import type { ExecutionResult, RegistryEntry } from "./plugin-executor.ts";
import { RUN_DEADLINE_MS } from "./runner.ts";
import { type DeadlineTimer, WorkerExecutor } from "./worker-executor.ts";

const SEQUENTIAL = 300;
const BURSTS = 10;
const BURST_SIZE = 16;
/** Each call is stopped this long at most after its plugin says it is inside its fetch. */
const MAX_STOP_DELAY_MS = 20;
/**
 * The bound on CI's runner, which guards suite time; the soak's other assertions are what prove it.
 * A call's cost is mostly evaluating zod and the SDK in a fresh worker, so the soak scales with
 * runner speed: on ubuntu-24.04 it took 12.1–17.1 s as Biome's check of the same files took
 * 0.77–1.26 s. 25 s is about 1.5× the slowest seen.
 */
const SOAK_BUDGET_MS = 25_000;
/** Long past any spawn, so a call that has not reached its fetch by then never will. */
const STALLED_MS = 2_000;

const entry = (name: string): RegistryEntry => {
	const path = new URL(`../test/worker-plugins/${name}.ts`, import.meta.url).href;
	return { path, load: () => import(path) };
};

const base = {
	appletId: "soak",
	runId: "soak",
	configDir: "/config/soak",
	persistent: {},
	component: "inputs",
} as const satisfies Partial<RunPayload>;

const ignored: Pick<HostPort, "credentials"> = {
	credentials: () => Promise.reject(new Error("not used")),
};

/** Open descriptors in this process, sockets included. */
const descriptors = () => readdirSync(platform() === "linux" ? "/proc/self/fd" : "/dev/fd").length;

type Mode = "hang" | "stream";
let servers: { hang: string; stream: string; stats: string; stop(): void };

beforeAll(async () => {
	const child = Bun.spawn(
		[process.execPath, new URL("../test/never-answering-servers.ts", import.meta.url).pathname],
		{ stdout: "pipe", stderr: "inherit" },
	);
	const reader = child.stdout.getReader();
	let text = "";
	while (!text.includes("\n")) {
		const { value, done } = await reader.read();
		if (done) throw new Error("The soak's servers exited before they were ready");
		text += new TextDecoder().decode(value);
	}
	reader.releaseLock();
	servers = { ...JSON.parse(text.split("\n")[0] ?? ""), stop: () => child.kill() };
});

afterAll(() => servers?.stop());

const openSockets = async () =>
	((await (await fetch(servers.stats)).json()) as { open: number }).open;

/** Polls `read` until it is at most `limit`, for up to a few seconds, and returns its last value. */
async function fallsTo(read: () => number | Promise<number>, limit: number): Promise<number> {
	const until = performance.now() + 3000;
	let value = await read();
	while (value > limit && performance.now() < until) {
		await Bun.sleep(50);
		value = await read();
	}
	return value;
}

test(
	"workers stopped mid-fetch, one at a time and in bursts, leave nothing behind",
	async () => {
		// Each call's deadline is a unique far-off key; the call is stopped by resolving its timer.
		const stops = new Map<number, () => void>();
		const deadline: DeadlineTimer = (deadlineMs, signal) =>
			new Promise((resolve) => {
				stops.set(deadlineMs, resolve);
				signal.addEventListener("abort", () => stops.delete(deadlineMs), { once: true });
			});
		const executor = new WorkerExecutor({ cap: BURST_SIZE, deadline });
		const fetchForever = entry("fetch-forever");
		const far = Date.now() + RUN_DEADLINE_MS;
		let calls = 0;
		let neverInFetch = 0;

		const call = async (mode: Mode): Promise<ExecutionResult> => {
			const deadlineMs = far + calls++;
			// A call that never reaches its fetch is stopped anyway, and counted, so it fails the soak
			// with a reason instead of stalling it.
			const fallback = setTimeout(() => {
				neverInFetch++;
				stops.get(deadlineMs)?.();
			}, STALLED_MS);
			const result = await executor.run(
				fetchForever,
				{ ...base, deadlineMs, instance: { url: servers[mode], mode } },
				{
					...ignored,
					log: ({ message }) => {
						if (message !== IN_FETCH) return;
						clearTimeout(fallback);
						setTimeout(() => stops.get(deadlineMs)?.(), Math.random() * MAX_STOP_DELAY_MS);
					},
				},
			);
			clearTimeout(fallback);
			return result;
		};

		await openSockets(); // Its keep-alive connection is part of the baseline.
		const baseline = descriptors();
		const started = performance.now();
		const results: ExecutionResult[] = [];
		for (let i = 0; i < SEQUENTIAL; i++) results.push(await call(i % 2 ? "hang" : "stream"));
		const sequentialMs = performance.now() - started;
		for (let burst = 0; burst < BURSTS; burst++) {
			const modes = Array.from({ length: BURST_SIZE }, (_, i): Mode => (i % 2 ? "hang" : "stream"));
			results.push(...(await Promise.all(modes.map(call))));
		}
		const burstsMs = performance.now() - started - sequentialMs;
		console.log(
			`Soak: ${SEQUENTIAL} sequential calls in ${Math.round(sequentialMs)} ms, ` +
				`${BURSTS} bursts of ${BURST_SIZE} in ${Math.round(burstsMs)} ms`,
		);

		expect(results).toHaveLength(SEQUENTIAL + BURSTS * BURST_SIZE);
		expect(neverInFetch).toBe(0);
		expect(results.filter((result) => result.ok || !result.timedOut)).toEqual([]);
		expect(await fallsTo(openSockets, 0)).toBe(0);
		// At most the baseline: test files before this one share the process and may close theirs.
		expect(await fallsTo(descriptors, baseline)).toBeLessThanOrEqual(baseline);
		const fresh = await executor.run(
			entry("probe"),
			{ ...base, deadlineMs: far + calls, instance: { act: "songs", count: 1 } },
			{ ...ignored, log: () => {} },
		);
		expect(fresh).toEqual({ ok: true, value: songs(1) });
		expect(performance.now() - started).toBeLessThan(SOAK_BUDGET_MS);
	},
	// Past the budget, so a slow soak fails on the assertion above with its timings logged.
	SOAK_BUDGET_MS * 4,
);
