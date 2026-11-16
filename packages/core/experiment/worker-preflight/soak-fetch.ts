// Soak: terminate() a worker mid-fetch, thousands of times. Usage:
//   bun soak-fetch.ts [cycles=2000] [parallel=1]
// Each cycle spawns `parallel` workers, waits until each is mid-request, then terminates them.
import {
	fdCount,
	loopLagMs,
	percentiles,
	platformTag,
	rssMb,
	settle,
	sleep,
	startHelper,
	writeCsv,
} from "./common.ts";

type Mode = "hang" | "stream";
interface Servers {
	hang: string;
	stream: string;
	stats: string;
}
interface Stats {
	hangOpen: number;
	hangAccepted: number;
	streamOpen: number;
	streamAccepted: number;
}

const cycles = Number(process.argv[2] ?? 2000);
const parallel = Number(process.argv[3] ?? 1);
const servers = await startHelper<Servers>("./slow-servers.ts");
const stats = async (): Promise<Stats> =>
	(await fetch(servers.info.stats)).json() as Promise<Stats>;
const workerUrl = new URL("./fetch-worker.ts", import.meta.url).href;

function inFlightWorker(mode: Mode): Promise<Worker | undefined> {
	const worker = new Worker(workerUrl, { ref: false });
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(undefined), 5000);
		worker.onmessage = () => {
			clearTimeout(timer);
			resolve(worker);
		};
		worker.onerror = () => resolve(undefined);
		worker.postMessage({ url: mode === "hang" ? servers.info.hang : servers.info.stream, mode });
	}).then((ready) => {
		if (!ready) worker.terminate();
		return ready as Worker | undefined;
	});
}

const terminateMs: number[] = [];
const lagMs: number[] = [];
const rows: (string | number)[][] = [];
let neverInFlight = 0;
let errors = 0;
process.on("uncaughtException", () => errors++);
const started = performance.now();

async function sample(cycle: number) {
	settle();
	const s = await stats();
	rows.push([
		cycle,
		rssMb().toFixed(1),
		fdCount(),
		s.hangOpen,
		s.streamOpen,
		s.hangAccepted + s.streamAccepted,
	]);
}

await sample(0);
settle();
const baseline = { rss: rssMb(), fds: fdCount() };
for (let cycle = 1; cycle <= cycles; cycle++) {
	const mode: Mode = cycle % 2 ? "hang" : "stream";
	const workers = await Promise.all(Array.from({ length: parallel }, () => inFlightWorker(mode)));
	await sleep(Math.random() * 20);
	for (const worker of workers) {
		if (!worker) {
			neverInFlight++;
			continue;
		}
		const t = performance.now();
		worker.terminate();
		terminateMs.push(performance.now() - t);
	}
	lagMs.push(await loopLagMs());
	if (cycle % 50 === 0) await sample(cycle);
}
const soakSeconds = (performance.now() - started) / 1000;

// Give the HTTP thread and the server time to notice closed sockets, then look for leaks.
await sleep(3000);
await sample(cycles + 1);
const final = await stats();
settle();

// The host must still be able to start a worker and fetch normally.
const echo = new Worker(new URL("./echo-worker.ts", import.meta.url).href);
const healthy = await new Promise<boolean>((resolve) => {
	echo.onmessage = (e) => resolve(e.data === "pong");
	setTimeout(() => resolve(false), 5000);
	echo.postMessage("ping");
});
echo.terminate();

const csv = writeCsv(
	`soak-fetch-p${parallel}`,
	["cycle", "rss_mb", "fds", "hang_open", "stream_open", "accepted"],
	rows,
);
console.log(
	JSON.stringify(
		{
			platform: platformTag,
			cycles,
			parallel,
			workersTerminated: terminateMs.length,
			neverInFlight,
			uncaughtErrors: errors,
			soakSeconds: Math.round(soakSeconds),
			terminateMs: percentiles(terminateMs),
			loopLagMs: percentiles(lagMs),
			baseline,
			after: { rss: rssMb(), fds: fdCount() },
			serverSocketsStillOpen: { hang: final.hangOpen, stream: final.streamOpen },
			serverAccepted: final.hangAccepted + final.streamAccepted,
			healthyAfter: healthy,
			csv,
		},
		null,
		2,
	),
);
servers.stop();
process.exit(0);
