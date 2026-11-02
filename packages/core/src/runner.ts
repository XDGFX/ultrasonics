import type { AppletDefinition, RunTrigger, Slot } from "@ultrasonics/db";
import {
	type AuthFailure,
	type AuthProvider,
	type Component,
	isAuthFailure,
	type LogLevel,
	OutputResult,
	type Plugin,
	type PluginRegistry,
	type RunPayload,
	type SongDict,
	type ValidationIssue,
	validateSongDict,
} from "@ultrasonics/plugin-sdk";
import type { z } from "zod";
import { describeError, InProcessExecutor, type PluginExecutor } from "./plugin-executor.ts";
import type {
	FinishedRunStatus,
	ResultPlaylist,
	RunEvent,
	RunEvents,
	StageError,
} from "./run-event.ts";

/** A run's wall-clock budget. Reported after the fact in Phase 1, not enforced (ADR-0010 #7). */
export const RUN_DEADLINE_MS = 60 * 60 * 1000;

/** Rejection events emitted per stage; the stage's `rejected` count carries the rest. */
export const REJECTIONS_EMITTED_PER_STAGE = 50;

/** What the server hands the runner, already bound to one account (ADR-0007). */
export interface RunCapabilities {
	auth: AuthProvider;
	/** The plugin's raw persistent settings, or `undefined` when none are saved. */
	persistentSettings(plugin: string): Promise<unknown>;
	configDir(plugin: string): string;
}

export interface RunAppletOptions {
	runId: string;
	applet: { id: string; name: string; definition: AppletDefinition };
	trigger: RunTrigger;
	registry: PluginRegistry;
	executor?: PluginExecutor;
	capabilities: RunCapabilities;
	events: RunEvents;
	/** The clock, in epoch milliseconds. */
	now?: () => number;
}

/** What `runApplet` resolves to; `interrupted` is set by boot, never here. */
export type RunOutcome = Exclude<FinishedRunStatus, "interrupted">;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Unstamped = DistributiveOmit<RunEvent, "seq" | "at">;

interface Stage {
	component: Component;
	index: number;
	plugin: string;
}

interface PreparedStage extends Stage {
	loaded: Plugin;
	persistent: Record<string, unknown>;
	instance: Record<string, unknown>;
}

const components = ["inputs", "modifiers", "outputs"] as const satisfies Component[];

function describeIssues(issues: ValidationIssue[]): string {
	return issues
		.map(({ path, message }) => (path.length ? `${path.join(".")}: ${message}` : message))
		.join("; ");
}

function countSongs(songs: SongDict): number {
	return songs.playlists.reduce((total, playlist) => total + playlist.songs.length, 0);
}

/** Why an output's result does not cover each playlist exactly once (ADR-0020 §2), if it doesn't. */
function incompleteness(result: OutputResult, songs: SongDict): string | undefined {
	const seen = new Set<number>();
	for (const entry of result.playlists) {
		const playlist = songs.playlists[entry.playlist];
		if (!playlist) return `Playlist ${entry.playlist} is out of range`;
		if (seen.has(entry.playlist)) return `Playlist ${entry.playlist} appears more than once`;
		seen.add(entry.playlist);
		if (entry.status !== "written") continue;
		const unmatched = new Set<number>();
		for (const position of entry.unmatched) {
			if (!playlist.songs[position] || unmatched.has(position)) {
				return `Playlist ${entry.playlist} has an invalid or repeated unmatched song ${position}`;
			}
			unmatched.add(position);
		}
	}
	const missing = songs.playlists.map((_, position) => position).filter((p) => !seen.has(p));
	return missing.length ? `Playlists ${missing.join(", ")} have no result` : undefined;
}

/**
 * Runs an applet's chain once: inputs, then modifiers, then outputs, one at a time. It emits run
 * events as it goes and resolves to how the run ended (ADR-0020 §5, amended by ADR-0021 §6).
 */
export async function runApplet(options: RunAppletOptions): Promise<RunOutcome> {
	const { applet, capabilities, registry } = options;
	const executor = options.executor ?? new InProcessExecutor();
	const now = options.now ?? Date.now;
	const deadlineMs = now() + RUN_DEADLINE_MS;

	let seq = 0;
	const emit = (event: Unstamped) =>
		options.events.emit({ ...event, seq: ++seq, at: now() } as RunEvent);
	const log = (level: LogLevel, text: string, source = "runner") =>
		emit({ type: "log", level, source, text });
	const where = ({ component, index, plugin }: Stage): Stage => ({ component, index, plugin });
	const finishStage = (
		stage: Stage,
		counts: { songs: number; playlists: number; rejected: number },
		error?: StageError,
	) =>
		emit({
			type: "stage",
			...where(stage),
			state: "finished",
			...counts,
			...(error ? { error } : {}),
		});
	const end = (status: RunOutcome): RunOutcome => {
		if (now() > deadlineMs)
			log("warn", `The run went past its ${RUN_DEADLINE_MS / 60_000}-minute deadline`);
		emit({ type: "end", status });
		return status;
	};

	log("info", `Applet ${applet.id} "${applet.name}"`);
	log("info", `Triggered by ${options.trigger}`);
	for (const component of components) {
		const plugins = applet.definition[component].map((slot) => slot.plugin);
		log("info", `${component}: ${plugins.length ? plugins.join(", ") : "none"}`);
	}

	// Preparation: every slot is loaded and its settings parsed before any plugin code runs.
	async function prepare(
		component: Component,
		slot: Slot,
		index: number,
	): Promise<PreparedStage | StageError | undefined> {
		const entry = Object.hasOwn(registry, slot.plugin) ? registry[slot.plugin] : undefined;
		if (!entry) {
			return { code: "unknown-plugin", message: `No plugin is registered as "${slot.plugin}"` };
		}
		let loaded: Plugin | undefined;
		try {
			loaded = (await entry.load()).default;
		} catch (error) {
			return { code: "threw", message: `"${slot.plugin}" failed to load: ${describeError(error)}` };
		}
		if (!loaded) {
			return { code: "contract", message: `"${slot.plugin}" has no default export` };
		}
		const schema = loaded.instanceSettings[component];
		if (!loaded.run[component] || !schema) {
			return {
				code: "missing-component",
				message: `"${slot.plugin}" does not implement ${component}`,
			};
		}
		let raw: unknown;
		try {
			raw = await capabilities.persistentSettings(slot.plugin);
		} catch (error) {
			// The host failed, not the plugin, so no stage error code fits; the log carries it.
			log("error", `Could not read the settings of "${slot.plugin}": ${describeError(error)}`);
			return undefined;
		}
		const persistent = loaded.persistentSettings?.safeParse(raw ?? {}) ?? {
			success: true as const,
			data: {},
		};
		const instance = schema.safeParse(slot.settings ?? {});
		const issues = [
			...(persistent.success ? [] : prefixed("persistent", persistent.error)),
			...(instance.success ? [] : prefixed("instance", instance.error)),
		];
		if (!persistent.success || !instance.success) {
			return { code: "settings-invalid", message: `Invalid settings: ${describeIssues(issues)}` };
		}
		return {
			component,
			index,
			plugin: slot.plugin,
			loaded,
			persistent: persistent.data as Record<string, unknown>,
			instance: instance.data as Record<string, unknown>,
		};
	}

	const prepared: Record<Component, PreparedStage[]> = { inputs: [], modifiers: [], outputs: [] };
	let preparedAll = true;
	for (const component of components) {
		for (const [index, slot] of applet.definition[component].entries()) {
			const stage = await prepare(component, slot, index);
			if (!stage) preparedAll = false;
			else if ("code" in stage) {
				preparedAll = false;
				finishStage(
					{ component, index, plugin: slot.plugin },
					{ songs: 0, playlists: 0, rejected: 0 },
					stage,
				);
			} else prepared[component].push(stage);
		}
	}
	if (!preparedAll) return end("failed");

	/** Calls one handler, keeping any `AuthFailure` host-side so a wrapped throw still carries it. */
	async function execute(
		stage: PreparedStage,
		songs: SongDict | undefined,
	): Promise<{ ok: true; value: unknown } | { ok: false; error: StageError }> {
		emit({
			type: "stage",
			...where(stage),
			state: "started",
		});
		let authFailure: AuthFailure | undefined;
		const { auth } = stage.loaded;
		const fields = {
			appletId: applet.id,
			runId: options.runId,
			deadlineMs,
			configDir: capabilities.configDir(stage.plugin),
			persistent: stage.persistent,
			instance: stage.instance,
		};
		const payload: RunPayload =
			stage.component === "inputs" || !songs
				? { ...fields, component: "inputs" }
				: { ...fields, component: stage.component, songs };
		const result = await executor.run(stage.loaded, payload, {
			credentials: async () => {
				if (!auth) throw new Error(`"${stage.plugin}" declares no service auth`);
				try {
					return await capabilities.auth.resolve(auth);
				} catch (error) {
					if (isAuthFailure(error)) authFailure = error;
					throw error;
				}
			},
			log: (entry) => log(entry.level, entry.message, stage.plugin),
		});
		if (result.ok) return result;
		return {
			ok: false,
			error: authFailure
				? { code: authFailure.code, message: result.message, auth: authFailure }
				: { code: "threw", message: result.message },
		};
	}

	/** Plugins already warned about stripped keys: one warning per plugin per run (ADR-0021 §2). */
	const warnedStripped = new Set<string>();

	/** Runs an input or modifier and validates what it returned (ADR-0021). */
	async function runSongStage(
		stage: PreparedStage,
		songs: SongDict | undefined,
	): Promise<{ songs: SongDict; rejected: number } | undefined> {
		const empty = { songs: 0, playlists: 0, rejected: 0 };
		const result = await execute(stage, songs);
		if (!result.ok) {
			finishStage(stage, empty, result.error);
			return undefined;
		}
		const validation = validateSongDict(result.value);
		if (!validation.ok) {
			const message = `Not a song dict: ${describeIssues(validation.issues)}`;
			finishStage(stage, empty, { code: "contract", message });
			return undefined;
		}
		for (const rejection of validation.rejections.slice(0, REJECTIONS_EMITTED_PER_STAGE)) {
			emit({ type: "rejection", ...where(stage), ...rejection });
		}
		if (validation.strippedKeys.length && !warnedStripped.has(stage.plugin)) {
			warnedStripped.add(stage.plugin);
			const keys = [...new Set(validation.strippedKeys.map((path) => String(path.at(-1))))];
			log("warn", `Stripped unknown keys from "${stage.plugin}": ${keys.join(", ")}`);
		}
		const rejected = validation.rejections.length;
		const clean = validation.songDict;
		finishStage(stage, { songs: countSongs(clean), playlists: clean.playlists.length, rejected });
		return { songs: clean, rejected };
	}

	let rejected = 0;
	const merged: SongDict = { version: 1, playlists: [] };
	for (const stage of prepared.inputs) {
		const outcome = await runSongStage(stage, undefined);
		if (!outcome) return end("failed");
		merged.playlists.push(...outcome.songs.playlists);
		rejected += outcome.rejected;
	}
	let songs = merged;
	for (const stage of prepared.modifiers) {
		const outcome = await runSongStage(stage, songs);
		if (!outcome) return end("failed");
		songs = outcome.songs;
		rejected += outcome.rejected;
	}

	let written = false;
	let problem = rejected > 0;
	const received = { songs: countSongs(songs), playlists: songs.playlists.length, rejected: 0 };
	for (const stage of prepared.outputs) {
		if (songs.playlists.length > 1 && !stage.loaded.mode.includes("playlists")) {
			log(
				"warn",
				`"${stage.plugin}" works on songs, but was given ${songs.playlists.length} playlists`,
			);
		}
		const outcome = await runOutput(stage, songs);
		const result = { type: "result" as const, index: stage.index, plugin: stage.plugin };
		if (!outcome.ok) {
			problem = true;
			finishStage(stage, received, outcome.error);
			emit({ ...result, outcome: { ok: false, error: outcome.error } });
			continue;
		}
		written ||= outcome.playlists.some((entry) => entry.status === "written");
		problem ||= outcome.playlists.some((entry) => entry.status === "failed");
		finishStage(stage, received);
		emit({ ...result, outcome: { ok: true, playlists: outcome.playlists } });
	}

	async function runOutput(
		stage: PreparedStage,
		songs: SongDict,
	): Promise<{ ok: true; playlists: ResultPlaylist[] } | { ok: false; error: StageError }> {
		const result = await execute(stage, structuredClone(songs));
		if (!result.ok) return result;
		const parsed = OutputResult.safeParse(result.value);
		const fault = parsed.success
			? incompleteness(parsed.data, songs)
			: describeIssues(prefixed("result", parsed.error));
		if (!parsed.success || fault) {
			return { ok: false, error: { code: "contract", message: `Invalid output result: ${fault}` } };
		}
		const playlists = parsed.data.playlists.map((entry) =>
			entry.status === "written"
				? {
						...entry,
						unmatchedSongs: entry.unmatched.map((position) =>
							structuredClone(songs.playlists[entry.playlist]?.songs[position]),
						),
					}
				: entry,
		);
		return { ok: true, playlists: playlists as ResultPlaylist[] };
	}

	return end(!problem ? "succeeded" : written ? "partial" : "failed");
}

function prefixed(prefix: string, error: z.ZodError): ValidationIssue[] {
	return error.issues.map((issue) => ({
		path: [prefix, ...issue.path.map((key) => (typeof key === "symbol" ? String(key) : key))],
		message: issue.message,
	}));
}
