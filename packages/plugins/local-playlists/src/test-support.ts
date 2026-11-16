import {
	createRunContext,
	type LogEntry,
	type OutputResult,
	type Plugin,
	RunPayload,
	type SongDictInput,
} from "@ultrasonics/plugin-sdk";
import localPlaylists from "./index.ts";

const plugin: Plugin = localPlaylists;

interface RunOptions {
	instance: Record<string, unknown>;
	persistent?: Record<string, unknown>;
	configDir?: string;
	appletId?: string;
}

/** A run context from the SDK harness, settings parsed as the runner parses them. */
function contextFor(
	component: "inputs" | "outputs",
	options: RunOptions,
	logs: LogEntry[],
	songs?: SongDictInput,
) {
	const payload = RunPayload.parse({
		component,
		appletId: options.appletId ?? "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: options.configDir ?? "/nonexistent",
		persistent: plugin.persistentSettings?.parse(options.persistent ?? {}),
		instance: plugin.instanceSettings[component]?.parse(options.instance),
		...(songs ? { songs } : {}),
	});
	return createRunContext(
		payload,
		{
			credentials: () => Promise.reject(new Error("local-playlists has no auth")),
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: false },
	);
}

/** Runs the `inputs` handler through the SDK harness. */
export async function readInputs(
	instance: Record<string, unknown>,
	persistent: Record<string, unknown> = {},
): Promise<{ songs: SongDictInput; logs: LogEntry[] }> {
	const logs: LogEntry[] = [];
	const songs = await plugin.run.inputs?.(contextFor("inputs", { instance, persistent }, logs));
	if (songs === undefined) throw new Error("local-playlists has no inputs handler");
	return { songs, logs };
}

/** Runs the `outputs` handler through the SDK harness. */
export async function writeOutputs(
	songs: SongDictInput,
	options: RunOptions,
): Promise<{ result: OutputResult; logs: LogEntry[] }> {
	const logs: LogEntry[] = [];
	const result = await plugin.run.outputs?.(contextFor("outputs", options, logs, songs));
	if (result === undefined) throw new Error("local-playlists has no outputs handler");
	return { result, logs };
}

export const lines = (logs: LogEntry[], level: LogEntry["level"]) =>
	logs.filter((entry) => entry.level === level).map((entry) => entry.message);
