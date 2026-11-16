// RSS across many Plex output runs. Usage: bun memory.ts <mode> [cycles=1000]
//   per-run       new worker per run, terminate() after the result (worker-per-run executor)
//   per-run-smol  the same with { smol: true }
//   kill-mid-run  new worker per run, terminate() 0-15 ms into the run (deadline breach mid-fetch)
//   warm          one worker reused for every run (warm pool of one)
//   in-process    InProcessExecutor, today's Phase 1 path
import plex from "../../../plugins/plex/src/index.ts";
import { InProcessExecutor } from "../../src/plugin-executor.ts";
import {
	fdCount,
	percentiles,
	platformTag,
	rssMb,
	settle,
	sleep,
	startHelper,
	writeCsv,
} from "./common.ts";
import { grantFor, hostPort, plexPayload, runInWorker, spawnPluginWorker } from "./plex-run.ts";

const mode = process.argv[2] ?? "per-run";
const cycles = Number(process.argv[3] ?? 1000);
const fake = await startHelper<{ url: string; token: string }>("./fake-plex-server.ts");
const grant = grantFor(fake.info);
const payload = plexPayload();

// Warm the host's own module graph so the baseline is not the first import.
await new InProcessExecutor().run(plex, payload, hostPort(grant));
settle();
await sleep(200);
settle();
const baseline = rssMb();
const rows: (string | number)[][] = [[0, mode, baseline.toFixed(1), fdCount()]];
const runMs: number[] = [];
let peak = baseline;
let failures = 0;
const warm = mode === "warm" ? await spawnPluginWorker() : undefined;

for (let cycle = 1; cycle <= cycles; cycle++) {
	const t = performance.now();
	if (mode === "in-process") {
		const result = await new InProcessExecutor().run(plex, payload, hostPort(grant));
		if (!result.ok) failures++;
	} else if (warm) {
		const result = await runInWorker(warm, payload, grant);
		if (result.kind !== "result" || !result.ok) failures++;
	} else {
		const worker = await spawnPluginWorker(mode === "per-run-smol");
		if (mode === "kill-mid-run") {
			void runInWorker(worker, payload, grant).catch(() => {});
			await sleep(Math.random() * 15);
		} else {
			const result = await runInWorker(worker, payload, grant);
			if (result.kind !== "result" || !result.ok) failures++;
		}
		worker.terminate();
	}
	runMs.push(performance.now() - t);
	peak = Math.max(peak, rssMb());
	if (cycle % 10 === 0) {
		settle();
		rows.push([cycle, mode, rssMb().toFixed(1), fdCount()]);
	}
}
warm?.terminate();
// Does memory come back once the churn stops?
let idle = 0;
for (const wait of [1000, 5000, 24000]) {
	await sleep(wait);
	idle += wait;
	settle();
	rows.push([cycles + 1, `${mode}-idle-${idle / 1000}s`, rssMb().toFixed(1), fdCount()]);
}
const after = rssMb();

const tail = rows.slice(-13, -3).map((row) => Number(row[2]));
const mid = rows
	.slice(Math.floor(rows.length / 2) - 5, Math.floor(rows.length / 2) + 5)
	.map((row) => Number(row[2]));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const csv = writeCsv(`memory-${mode}-${cycles}`, ["cycle", "mode", "rss_mb", "fds"], rows);
console.log(
	JSON.stringify({
		platform: platformTag,
		mode,
		cycles,
		failures,
		baselineMb: +baseline.toFixed(1),
		peakMb: +peak.toFixed(1),
		midRunMeanMb: +mean(mid).toFixed(1),
		lastTenSamplesMeanMb: +mean(tail).toFixed(1),
		afterIdleMb: +after.toFixed(1),
		growthSecondHalfMbPer100: +(((mean(tail) - mean(mid)) / (cycles / 2)) * 100).toFixed(2),
		runMs: percentiles(runMs),
		csv,
	}),
);
fake.stop();
process.exit(0);
