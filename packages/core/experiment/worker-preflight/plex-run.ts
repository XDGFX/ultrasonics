// A realistic Plex output run: twenty songs from the fake's recorded library, appended to one playlist.
import { readFileSync } from "node:fs";
import { type HostPort, RunPayload } from "@ultrasonics/plugin-sdk";
import plex from "../../../plugins/plex/src/index.ts";
import type { FromWorker, ToWorker } from "./plugin-worker.ts";

/** The plugin by path, as a worker must load it (ADR-0010, Consequences). */
export const plexPath = new URL("../../../plugins/plex/src/index.ts", import.meta.url).pathname;

interface Track {
	title: string;
	grandparentTitle: string;
	parentTitle: string;
	duration: number;
}

export function plexPayload(): RunPayload {
	const library = JSON.parse(
		readFileSync(
			new URL("../../../plugins/plex/test/fixtures/library-section-tracks.json", import.meta.url),
			"utf8",
		),
	) as { MediaContainer: { Metadata: Track[] } };
	const songs = library.MediaContainer.Metadata.map((track) => ({
		title: track.title,
		artists: [track.grandparentTitle],
		album: track.parentTitle,
		durationMs: track.duration,
	}));
	return RunPayload.parse({
		component: "outputs",
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: "/nonexistent",
		persistent: {},
		instance: plex.instanceSettings.outputs.parse({}),
		songs: { playlists: [{ name: "Preflight", songs }] },
	});
}

export function grantFor(server: { url: string; token: string }): unknown {
	if (!plex.auth) throw new Error("plex declares no auth");
	return plex.auth.fields.parse({ serverUrl: server.url, token: server.token });
}

export function hostPort(grant: unknown): HostPort {
	return { credentials: async () => grant, log: () => {} };
}

/** Runs the plugin in `worker`, answering its credential requests, until it reports a result. */
export function runInWorker(
	worker: Worker,
	payload: RunPayload,
	grant: unknown,
): Promise<FromWorker> {
	return new Promise((resolve, reject) => {
		worker.onerror = (error) => reject(error);
		worker.onmessage = (event: MessageEvent<FromWorker>) => {
			const message = event.data;
			if (message.kind === "credentials") {
				worker.postMessage({
					kind: "credentials",
					id: message.id,
					value: grant,
				} satisfies ToWorker);
			} else if (message.kind === "result") resolve(message);
		};
		worker.postMessage({ kind: "run", path: plexPath, payload } satisfies ToWorker);
	});
}

export function spawnPluginWorker(smol = false): Promise<Worker> {
	const worker = new Worker(new URL("./plugin-worker.ts", import.meta.url).href, {
		ref: false,
		smol,
	});
	return new Promise((resolve) => {
		worker.onmessage = () => resolve(worker);
	});
}
