// Re-checks the terminate() crux table from the isolation research on this Bun version.
// Each case runs in its own child so a thread that never dies cannot wedge the others.
// Usage: bun crux.ts            (parent)    bun crux.ts <case>   (one case)
const cases = [
	"spin",
	"sleepSync",
	"atomicsWait",
	"nodeTerminateSpin",
	"nodeTerminateSleepSync",
] as const;
const bodies: Record<string, string> = {
	spin: "postMessage('go'); for(;;){}",
	sleepSync: "postMessage('go'); Bun.sleepSync(8000);",
	atomicsWait: "postMessage('go'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);",
};

const which = process.argv[2];
if (which) {
	const node = which.startsWith("nodeTerminate");
	const body = bodies[node ? (which === "nodeTerminateSpin" ? "spin" : "sleepSync") : which] ?? "";
	const url = URL.createObjectURL(new Blob([body], { type: "application/javascript" }));
	const started = performance.now();
	if (node) {
		const { Worker: NodeWorker } = await import("node:worker_threads");
		const nodeBody = `const { parentPort } = require("node:worker_threads"); const postMessage = (m) => parentPort.postMessage(m); ${body}`;
		const worker = new NodeWorker(nodeBody, { eval: true });
		await new Promise((resolve) => worker.once("message", resolve));
		const settled = await Promise.race([
			worker.terminate().then(() => "resolved"),
			new Promise((resolve) => setTimeout(() => resolve("pending after 2s"), 2000)),
		]);
		console.log(JSON.stringify({ case: which, terminatePromise: settled }));
	} else {
		const worker = new Worker(url);
		await new Promise((resolve) => {
			worker.onmessage = resolve;
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		const t = performance.now();
		const returned = worker.terminate();
		const returnMs = performance.now() - t;
		// Is the host loop alive while the worker is (supposedly) dying?
		const lag = await new Promise<number>((resolve) => {
			const s = performance.now();
			setTimeout(() => resolve(performance.now() - s), 10);
		});
		console.log(
			JSON.stringify({
				case: which,
				returned: String(returned),
				returnMs,
				hostTimer10msFiredAfter: lag,
			}),
		);
	}
	void started;
	// Exits only if the worker thread is gone; the parent measures that.
} else {
	for (const name of cases) {
		const t = performance.now();
		const child = Bun.spawn(["bun", import.meta.path, name], { stdout: "pipe", stderr: "pipe" });
		const timeout = setTimeout(() => child.kill(), 15_000);
		const code = await child.exited;
		clearTimeout(timeout);
		const line = (await new Response(child.stdout).text()).trim();
		console.log(
			JSON.stringify({
				...JSON.parse(line || "{}"),
				case: name,
				processExitedAfterMs: Math.round(performance.now() - t),
				exitCode: code,
				killedByTimeout: child.signalCode !== null,
			}),
		);
	}
}
