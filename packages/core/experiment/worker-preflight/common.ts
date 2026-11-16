import { readdirSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";

/** Open file descriptors in this process, sockets included. The readdir itself costs one. */
export function fdCount(): number {
	return readdirSync(platform() === "linux" ? "/proc/self/fd" : "/dev/fd").length;
}

export function rssMb(): number {
	return process.memoryUsage().rss / 1024 / 1024;
}

export function settle(): void {
	Bun.gc(true);
}

/** Main-thread responsiveness: how late a zero-delay timer fires. */
export function loopLagMs(): Promise<number> {
	const start = performance.now();
	return new Promise((resolve) => setTimeout(() => resolve(performance.now() - start), 0));
}

export function percentiles(values: number[]): Record<string, number> {
	const sorted = [...values].sort((a, b) => a - b);
	const at = (q: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
	const round = (n: number) => Math.round(n * 1000) / 1000;
	return {
		n: sorted.length,
		min: round(sorted[0] ?? NaN),
		p50: round(at(0.5)),
		p90: round(at(0.9)),
		p99: round(at(0.99)),
		max: round(sorted.at(-1) ?? NaN),
	};
}

export const platformTag = `${platform()}-${arch()}-bun${Bun.version}`;

export function resultsPath(name: string): string {
	return new URL(`./results/${platformTag}-${name}`, import.meta.url).pathname;
}

export function writeCsv(name: string, header: string[], rows: (string | number)[][]): string {
	const path = resultsPath(`${name}.csv`);
	writeFileSync(path, [header.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n");
	return path;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Starts a helper script as a child process and reads the one JSON line it prints when ready. */
export async function startHelper<T>(script: string): Promise<{ info: T; stop(): void }> {
	const child = Bun.spawn(["bun", new URL(script, import.meta.url).pathname], {
		stdout: "pipe",
		stderr: "inherit",
	});
	const reader = child.stdout.getReader();
	let text = "";
	while (!text.includes("\n")) {
		const { value, done } = await reader.read();
		if (done) throw new Error(`${script} exited before it was ready`);
		text += new TextDecoder().decode(value);
	}
	reader.releaseLock();
	return { info: JSON.parse(text.split("\n")[0] ?? "") as T, stop: () => child.kill() };
}
