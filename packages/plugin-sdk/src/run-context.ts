import { z } from "zod";
import type { AuthSpec, Credentials } from "./auth.ts";
import type { SettingsSchema } from "./settings-form.ts";
import { SongDict } from "./song-dict.ts";

const Settings = z.record(z.string(), z.unknown());

const RunFields = z.object({
	appletId: z.string(),
	runId: z.string(),
	/** The run's wall-clock deadline, in epoch milliseconds; nothing enforces it yet. */
	deadlineMs: z.number(),
	/** A path, never a handle (ADR-0010 #8). */
	configDir: z.string(),
	persistent: Settings,
	instance: Settings,
});
type RunFields = z.infer<typeof RunFields>;

/**
 * The plain data that crosses the plugin boundary for one handler call (ADR-0010 §4). The harness
 * on the plugin's side rebuilds a live context around it.
 */
export const RunPayload = z.discriminatedUnion("component", [
	RunFields.extend({ component: z.literal("inputs") }),
	RunFields.extend({ component: z.literal("modifiers"), songs: SongDict }),
	RunFields.extend({ component: z.literal("outputs"), songs: SongDict }),
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

type LiveAuth = { auth?: { get(): Promise<unknown> } };

/** What an input handler receives: `instance` typed from its own component's schema. */
export type RunContext<Instance, Persistent, Auth> = Omit<RunFields, "persistent" | "instance"> & {
	persistent: PersistentOf<Persistent>;
	instance: Instance;
	log: Log;
} & AuthFacade<Auth>;

/** What a modifier or output handler receives. */
export type SongsContext<Instance, Persistent, Auth> = RunContext<Instance, Persistent, Auth> & {
	songs: SongDict;
};

/** What `test()` receives: no instance settings, since no applet exists yet (ADR-0012 §5). */
export type TestContext<Persistent, Auth> = Omit<TestPayload, "persistent"> & {
	persistent: PersistentOf<Persistent>;
	log: Log;
} & AuthFacade<Auth>;

/** A context as the runner holds it, before any plugin's types narrow it. */
export type LiveRunContext = RunFields & { log: Log; songs?: SongDict } & LiveAuth;

export type LiveTestContext = TestPayload & { log: Log } & LiveAuth;

/** Whether the plugin declares auth; only then does its context carry `auth`. */
export interface HarnessOptions {
	declaresAuth: boolean;
}

function authFacade(port: HostPort, options: HarnessOptions): LiveAuth {
	return options.declaresAuth ? { auth: { get: () => port.credentials() } } : {};
}

function createLog(port: HostPort, runId: string | undefined): Log {
	const line = (level: LogLevel) => (message: string) =>
		port.log(runId === undefined ? { level, message } : { runId, level, message });
	return { debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error") };
}

/**
 * The plugin-side harness: rebuilds a live context from a payload and the host port, so only plain
 * data has to cross the boundary.
 */
export function createRunContext(
	payload: RunPayload,
	port: HostPort,
	options: HarnessOptions,
): LiveRunContext {
	const { component: _, ...data } = payload;
	return { ...data, log: createLog(port, payload.runId), ...authFacade(port, options) };
}

export function createTestContext(
	payload: TestPayload,
	port: HostPort,
	options: HarnessOptions,
): LiveTestContext {
	return { ...payload, log: createLog(port, undefined), ...authFacade(port, options) };
}
