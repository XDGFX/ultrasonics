// A worker that loads one plugin from its resolved path, as the `WorkerExecutor`'s worker does, and
// posts back its name, version and components, or why it could not load it.
import type { Plugin } from "@ultrasonics/plugin-sdk";

declare const self: Worker;

self.addEventListener("message", async (event: MessageEvent<string>) => {
	try {
		const plugin = ((await import(event.data)) as { default: Plugin }).default;
		const { name, version } = plugin;
		postMessage({ name, version, components: Object.keys(plugin.run).sort() });
	} catch (error) {
		postMessage({ failed: error instanceof Error ? error.message : String(error) });
	}
});
