import { expect, test } from "bun:test";
import { officialPlugins } from "@ultrasonics/registry";

const describeInWorker = new URL("../test/describe-in-worker.ts", import.meta.url).href;

/** What a fresh worker sees of the plugin at `path`. */
async function seenInWorker(path: string): Promise<unknown> {
	const worker = new Worker(describeInWorker);
	try {
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		worker.addEventListener("message", (event: MessageEvent) => resolve(event.data));
		worker.addEventListener("error", (event: ErrorEvent) => reject(new Error(event.message)));
		worker.postMessage(path);
		return await promise;
	} finally {
		worker.terminate();
	}
}

// The server runs every handler in a worker (ADR-0031), so a plugin that cannot load in one cannot
// run at all. Walks the whole registry, so a plugin added later is covered here.
test.each(Object.entries(officialPlugins))(
	"%s loads in a worker from its path as the host loads it",
	async (_, entry) => {
		expect(new URL(entry.path).protocol).toBe("file:");
		const plugin = (await entry.load()).default;
		expect(await seenInWorker(entry.path)).toEqual({
			name: plugin.name,
			version: plugin.version,
			components: Object.keys(plugin.run).sort(),
		});
	},
);
