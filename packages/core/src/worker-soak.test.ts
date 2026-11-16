// The CI-sized soak of terminate-mid-`fetch` (research §3–4, scaled down). The full soak runs before
// every Bun upgrade (`docs/build-process.md` § Upgrading Bun); this one catches a regression in CI.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { platform } from "node:os";
import type { HostPort, RunPayload } from "@ultrasonics/plugin-sdk";
import { IN_FETCH } from "../test/worker-plugins/fetch-forever.ts";
import { songs } from "../test/worker-plugins/probe.ts";
import type { ExecutionResult, RegistryEntry } from "./plugin-executor.ts";
import { type DeadlineTimer, WorkerExecutor } from "./worker-executor.ts";

const SEQUENTIAL = 300;
const BURSTS = 10;
const BURST_SIZE = 16;
/** Each call is stopped this long at most after its plugin says it is inside its fetch. */
const MAX_STOP_DELAY_MS = 20;
/** The acceptance bound on CI's runner. */
const SOAK_BUDGET_MS = 15_000;

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

/** Polls `read` until it returns `want`, for up to a few seconds, and returns its last value. */
async function settlesTo(read: () => number | Promise<number>, want: number): Promise<number> {
	const until = performance.now() + 3000;
	let value = await read();
	while (value !== want && performance.now() < until) {
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
		const far = Date.now() + 60 * 60 * 1000;
		let calls = 0;

		const call = (mode: Mode): Promise<ExecutionResult> => {
			const deadlineMs = far + calls++;
			return executor.run(
				fetchForever,
				{ ...base, deadlineMs, instance: { url: servers[mode], mode } },
				{
					...ignored,
					log: ({ message }) => {
						if (message !== IN_FETCH) return;
						setTimeout(() => stops.get(deadlineMs)?.(), Math.random() * MAX_STOP_DELAY_MS);
					},
				},
			);
		};

		await openSockets(); // Its keep-alive connection is part of the baseline.
		const baseline = descriptors();
		const results: ExecutionResult[] = [];
		for (let i = 0; i < SEQUENTIAL; i++) results.push(await call(i % 2 ? "hang" : "stream"));
		for (let burst = 0; burst < BURSTS; burst++) {
			const modes = Array.from({ length: BURST_SIZE }, (_, i): Mode => (i % 2 ? "hang" : "stream"));
			results.push(...(await Promise.all(modes.map(call))));
		}

		expect(results).toHaveLength(SEQUENTIAL + BURSTS * BURST_SIZE);
		expect(results.filter((result) => result.ok || !result.timedOut)).toEqual([]);
		expect(await settlesTo(openSockets, 0)).toBe(0);
		expect(await settlesTo(descriptors, baseline)).toBe(baseline);
		const fresh = await executor.run(
			entry("probe"),
			{ ...base, deadlineMs: far + calls, instance: { act: "songs", count: 1 } },
			{ ...ignored, log: () => {} },
		);
		expect(fresh).toEqual({ ok: true, value: songs(1) });
	},
	SOAK_BUDGET_MS,
);
