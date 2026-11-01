import { z } from "zod";
import type { AuthSpec } from "./auth.ts";
import type { OutputResult } from "./output-result.ts";
import type {
	LiveRunContext,
	LiveTestContext,
	RunContext,
	SongsContext,
	TestContext,
} from "./run-context.ts";
import type { SettingsSchema } from "./settings-form.ts";
import type { SongDictInput } from "./song-dict.ts";

/** The slot a plugin occupies in an applet; the keying axis of the whole surface (ADR-0012). */
export const Component = z.enum(["inputs", "modifiers", "outputs"]);
export type Component = z.infer<typeof Component>;

export const Mode = z.enum(["playlists", "songs"]);
export type Mode = z.infer<typeof Mode>;

/** What `test()` returns; a throw from `test()` means the plugin itself is broken (ADR-0012 §5). */
export const TestResult = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true) }),
	z.object({
		ok: z.literal(false),
		code: z.enum(["invalid-credentials", "unreachable", "misconfigured"]),
		message: z.string(),
	}),
]);
export type TestResult = z.infer<typeof TestResult>;

export type InstanceSettings = Partial<Record<Component, SettingsSchema>>;

type Handler<K, Schema, Persistent, Auth> = Schema extends z.ZodType
	? K extends "inputs"
		? (ctx: RunContext<z.output<Schema>, Persistent, Auth>) => Promise<SongDictInput>
		: K extends "modifiers"
			? (ctx: SongsContext<z.output<Schema>, Persistent, Auth>) => Promise<SongDictInput>
			: K extends "outputs"
				? (ctx: SongsContext<z.output<Schema>, Persistent, Auth>) => Promise<OutputResult>
				: never
	: never;

/** One handler per key of `instanceSettings`, no more and no fewer (ADR-0012 §2). */
type Handlers<S, Persistent, Auth> = { [K in keyof S]-?: Handler<K, S[K], Persistent, Auth> };

export interface PluginDefinition<
	S extends InstanceSettings,
	Persistent extends SettingsSchema | undefined,
	Auth extends AuthSpec | undefined,
> {
	name: string;
	description: string;
	version: string;
	mode: readonly [Mode, ...Mode[]];
	auth?: Auth;
	persistentSettings?: Persistent;
	instanceSettings: S;
	run: Handlers<S, Persistent, Auth>;
	test?: (ctx: TestContext<Persistent, Auth>) => Promise<TestResult>;
}

export type DefinedPlugin<
	S extends InstanceSettings,
	Persistent extends SettingsSchema | undefined,
	Auth extends AuthSpec | undefined,
> = PluginDefinition<S, Persistent, Auth> & { components: Extract<keyof S, Component>[] };

/**
 * Declares a plugin, typing each handler's context from the schema under its own component's key.
 * `components` is derived from `run`, so there is one list of components, not three.
 */
export function definePlugin<
	S extends InstanceSettings,
	Persistent extends SettingsSchema | undefined = undefined,
	Auth extends AuthSpec | undefined = undefined,
>(definition: PluginDefinition<S, Persistent, Auth>): DefinedPlugin<S, Persistent, Auth> {
	// `Object.keys` widens to string[]; `Handlers` admits only component keys.
	const components = Object.keys(definition.run) as Extract<keyof S, Component>[];
	return { ...definition, components };
}

/** The plain-data part of a plugin the runner reads before calling anything. */
export const Handshake = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	version: z.string().min(1),
	mode: z.array(Mode).min(1).readonly(),
	components: z.array(Component).min(1).readonly(),
});

/**
 * Any plugin, as the runner and registry hold it. Handlers are methods so that a plugin's narrowly
 * typed handlers are assignable here.
 */
export interface Plugin extends z.infer<typeof Handshake> {
	auth?: AuthSpec | undefined;
	persistentSettings?: SettingsSchema | undefined;
	instanceSettings: InstanceSettings;
	run: {
		inputs?(ctx: LiveRunContext): Promise<SongDictInput>;
		modifiers?(ctx: LiveRunContext): Promise<SongDictInput>;
		outputs?(ctx: LiveRunContext): Promise<OutputResult>;
	};
	test?(ctx: LiveTestContext): Promise<TestResult>;
}

/** Plugin name to its module path and loader; a later Worker receives the path (ADR-0012 §4). */
export type PluginRegistry = Record<string, { path: string; load(): Promise<{ default: Plugin }> }>;
