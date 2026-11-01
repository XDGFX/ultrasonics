import { z } from "zod";
import type { AuthSpec, Credentials } from "./auth.ts";
import type { SettingsSchema } from "./settings-form.ts";
import { SongDict } from "./song-dict.ts";

const Settings = z.record(z.string(), z.unknown());

const runFields = {
	appletId: z.string(),
	runId: z.string(),
	/** The run's wall-clock deadline, in epoch milliseconds; reported, not enforced, in Phase 1. */
	deadlineMs: z.number(),
	/** A path, never a handle (ADR-0010 #8). */
	configDir: z.string(),
	persistent: Settings,
	instance: Settings,
};

/**
 * The plain data that crosses the plugin boundary for one handler call (ADR-0010 §4). The harness
 * on the plugin's side rebuilds a live context around it.
 */
export const RunPayload = z.discriminatedUnion("component", [
	z.object({ component: z.literal("inputs"), ...runFields }),
	z.object({ component: z.literal("modifiers"), ...runFields, songs: SongDict }),
	z.object({ component: z.literal("outputs"), ...runFields, songs: SongDict }),
]);
export type RunPayload = z.infer<typeof RunPayload>;

/** What crosses the boundary for `test()`, which runs before any applet exists. */
export const TestPayload = z.object({ persistent: Settings, configDir: z.string() });
export type TestPayload = z.infer<typeof TestPayload>;

export const LogLevel = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevel>;

/** One log line on its way to the run event `log` (ADR-0026). A test context has no run. */
export const LogEntry = z.object({
	runId: z.string().optional(),
	level: LogLevel,
	message: z.string(),
});
export type LogEntry = z.infer<typeof LogEntry>;

/** Fire-and-forget: nothing is awaited (ADR-0010 #3). */
export type Log = Record<LogLevel, (message: string) => void>;

/** The host's side of the boundary, and all of it (ADR-0010 #2, #3). */
export interface HostPort {
	/** Resolves the plugin's credentials host-side; rejects with an `AuthFailure`. */
	credentials(): Promise<unknown>;
	log(entry: LogEntry): void;
}

type AuthFacade<A> = [A] extends [AuthSpec]
	? { auth: { get(): Promise<Credentials<A>> } }
	: unknown;
type PersistentOf<P> = [P] extends [SettingsSchema] ? z.output<P> : Record<string, never>;

/** What an input handler receives: `instance` typed from its own component's schema. */
export type RunContext<Instance, Persistent, Auth> = {
	appletId: string;
	runId: string;
	deadlineMs: number;
	configDir: string;
	persistent: PersistentOf<Persistent>;
	instance: Instance;
	log: Log;
} & AuthFacade<Auth>;

/** What a modifier or output handler receives. */
export type SongsContext<Instance, Persistent, Auth> = RunContext<Instance, Persistent, Auth> & {
	songs: SongDict;
};

/** What `test()` receives: no instance settings, since no applet exists yet (ADR-0012 §5). */
export type TestContext<Persistent, Auth> = {
	configDir: string;
	persistent: PersistentOf<Persistent>;
	log: Log;
} & AuthFacade<Auth>;

/** A context as the runner holds it, before any plugin's types narrow it. */
export interface LiveRunContext {
	appletId: string;
	runId: string;
	deadlineMs: number;
	configDir: string;
	persistent: Record<string, unknown>;
	instance: Record<string, unknown>;
	log: Log;
	auth?: { get(): Promise<unknown> };
	songs?: SongDict;
}

export interface LiveTestContext {
	configDir: string;
	persistent: Record<string, unknown>;
	log: Log;
	auth?: { get(): Promise<unknown> };
}

function createLog(port: HostPort, runId: string | undefined): Log {
	const line = (level: LogLevel) => (message: string) =>
		port.log(runId === undefined ? { level, message } : { runId, level, message });
	return { debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error") };
}

/**
 * The plugin-side harness: rebuilds a live context from a payload and the host port. The Phase 1
 * executor calls it in-process; the Phase 2 worker calls the same function.
 */
export function createRunContext(payload: RunPayload, port: HostPort): LiveRunContext {
	const { component: _, ...data } = payload;
	return { ...data, log: createLog(port, payload.runId), auth: { get: () => port.credentials() } };
}

export function createTestContext(payload: TestPayload, port: HostPort): LiveTestContext {
	return { ...payload, log: createLog(port, undefined), auth: { get: () => port.credentials() } };
}
