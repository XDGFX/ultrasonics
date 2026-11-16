// Worker costs against in-process. Usage: bun cost.ts
import plex from "../../../plugins/plex/src/index.ts";
import { InProcessExecutor } from "../../src/plugin-executor.ts";
import { percentiles, platformTag, rssMb, settle, sleep, startHelper } from "./common.ts";
import { grantFor, hostPort, plexPayload, runInWorker, spawnPluginWorker } from "./plex-run.ts";
import type { FromWorker } from "./plugin-worker.ts";

const out: Record<string, unknown> = { platform: platformTag };
const echoUrl = new URL("./echo-worker.ts", import.meta.url).href;

// 1. Spawn: construct -> first message back, for a bare worker and for the plugin harness.
async function timeSpawn(make: () => Promise<Worker>, n: number) {
	const times: number[] = [];
	for (let i = 0; i < n; i++) {
		const t = performance.now();
		const worker = await make();
		times.push(performance.now() - t);
		worker.terminate();
	}
	return percentiles(times);
}
const bare = () =>
	new Promise<Worker>((resolve) => {
		const worker = new Worker(echoUrl, { ref: false });
		worker.onmessage = () => resolve(worker);
		worker.postMessage("ping");
	});
out.spawnBareMs = await timeSpawn(bare, 200);
out.spawnSdkHarnessMs = await timeSpawn(() => spawnPluginWorker(), 200);

// 2. A whole Plex run: fresh worker (spawn + import plex + run) vs warm worker vs in-process.
const fake = await startHelper<{ url: string; token: string }>("./fake-plex-server.ts");
const grant = grantFor(fake.info);
const payload = plexPayload();
const inProcess = new InProcessExecutor();
await inProcess.run(plex, payload, hostPort(grant));
const runs = { fresh: [] as number[], warm: [] as number[], inProcess: [] as number[] };
const warm = await spawnPluginWorker();
await runInWorker(warm, payload, grant);
for (let i = 0; i < 100; i++) {
	let t = performance.now();
	const fresh = await spawnPluginWorker();
	await runInWorker(fresh, payload, grant);
	runs.fresh.push(performance.now() - t);
	fresh.terminate();
	t = performance.now();
	await runInWorker(warm, payload, grant);
	runs.warm.push(performance.now() - t);
	t = performance.now();
	await inProcess.run(plex, payload, hostPort(grant));
	runs.inProcess.push(performance.now() - t);
}
out.plexRunFreshWorkerMs = percentiles(runs.fresh);
out.plexRunWarmWorkerMs = percentiles(runs.warm);
out.plexRunInProcessMs = percentiles(runs.inProcess);

// 3. Message round trip vs an awaited in-process call.
function ping(worker: Worker, data: unknown): Promise<unknown> {
	return new Promise((resolve) => {
		worker.onmessage = (event: MessageEvent<FromWorker>) => resolve(event.data);
		worker.postMessage({ kind: "ping", data });
	});
}
const rtt: number[] = [];
for (let i = 0; i < 10_000; i++) {
	const t = performance.now();
	await ping(warm, i);
	rtt.push(performance.now() - t);
}
out.workerRoundTripMs = percentiles(rtt);
const local = async (x: number) => x;
const direct: number[] = [];
for (let i = 0; i < 10_000; i++) {
	const t = performance.now();
	await local(i);
	direct.push(performance.now() - t);
}
out.inProcessAwaitMs = percentiles(direct);

// 4. A 10,000-song playlist across the boundary.
const songs = Array.from({ length: 10_000 }, (_, i) => ({
	title: `Song number ${i} (Remastered 2011)`,
	artists: [`Artist ${i % 977}`, `Featured ${i % 131}`],
	album: `Album ${i % 1201}`,
	date: "2011-04-18",
	isrc: `GBAYE${String(1_100_000 + i).padStart(7, "0")}`,
	durationMs: 180_000 + (i % 120_000),
	explicit: i % 7 === 0,
	id: {
		spotify: `4uLU6hMCjMI75M1A2tKUQ${i}`,
		isrc: `GBAYE${String(1_100_000 + i).padStart(7, "0")}`,
	},
}));
const dict = {
	version: 1,
	playlists: [{ name: "Ten thousand", id: { spotify: "37i9dQZF1DX" }, songs }],
};
out.tenThousandSongJsonBytes = JSON.stringify(dict).length;
const clone: number[] = [];
for (let i = 0; i < 30; i++) {
	const t = performance.now();
	structuredClone(dict);
	clone.push(performance.now() - t);
}
out.tenThousandStructuredCloneMs = percentiles(clone);
const trip: number[] = [];
for (let i = 0; i < 30; i++) {
	const t = performance.now();
	await ping(warm, dict);
	trip.push(performance.now() - t);
}
out.tenThousandPostMessageRoundTripMs = percentiles(trip);
warm.terminate();

// 5. RSS cost of each live worker that has loaded and run the Plex plugin.
settle();
await sleep(200);
const before = rssMb();
const live: Worker[] = [];
for (let i = 0; i < 20; i++) {
	const worker = await spawnPluginWorker();
	await runInWorker(worker, payload, grant);
	live.push(worker);
}
settle();
const during = rssMb();
for (const worker of live) worker.terminate();
await sleep(2000);
settle();
out.liveLoadedPlexWorkers = {
	count: 20,
	beforeMb: +before.toFixed(1),
	with20LiveMb: +during.toFixed(1),
	perWorkerMb: +((during - before) / 20).toFixed(1),
	twoSecondsAfterTerminateMb: +rssMb().toFixed(1),
};

console.log(JSON.stringify(out, null, 2));
fake.stop();
process.exit(0);
