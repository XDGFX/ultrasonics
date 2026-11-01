// The conformance suite, behind its own subpath export so runtime code never imports `bun:test`.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AuthSpec } from "./auth.ts";
import { OutputResult } from "./output-result.ts";
import { Component, Mode, type Plugin, TestResult } from "./plugin.ts";
import {
	createRunContext,
	createTestContext,
	type HostPort,
	type RunPayload,
} from "./run-context.ts";
import { Service } from "./service.ts";
import { toFormSchema } from "./settings-form.ts";
import { SongDict, type SongDictInput } from "./song-dict.ts";
import { type IssuePath, validateSongDict } from "./song-dict-validator.ts";

/** What conformance checks, in the order of spec #108 (ADR-0010 §5, ADR-0012 §8, ADR-0019–0021). */
export const invariants = [
	"handshake",
	"settings-fixtures",
	"key-parity",
	"clone-boundary",
	"lost-methods",
	"renderable-subset",
	"output-completeness",
	"valid-song-dict",
	"known-service",
	"output-immutability",
	"test-result",
] as const;
export type Invariant = (typeof invariants)[number];

export interface ConformanceFailure {
	invariant: Invariant;
	path: IssuePath;
	message: string;
}

/** Values a schema must accept, the first of which conformance runs with, and values it must reject. */
export interface SettingsFixture<Input> {
	valid: [Input, ...Input[]];
	invalid: unknown[];
}

type InputOf<Schema> = Schema extends z.ZodType ? z.input<Schema> : never;
type FieldsOf<Auth> = Auth extends AuthSpec ? z.input<Auth["fields"]> : never;

export interface ConformanceFixtures<P extends Plugin> {
	persistentSettings?: SettingsFixture<InputOf<P["persistentSettings"]>>;
	instanceSettings: {
		[K in keyof P["instanceSettings"]]-?: SettingsFixture<InputOf<P["instanceSettings"][K]>>;
	};
	/** What the stub host port resolves, parsed by the auth fields. */
	credentials?: FieldsOf<P["auth"]>;
	/** The song dict modifiers and outputs receive; `defaultSongDict` otherwise. */
	songs?: SongDictInput;
}

/** Several playlists, an empty one among them, so output completeness has something to check. */
export const defaultSongDict = {
	version: 1,
	playlists: [
		{
			name: "Focus",
			id: { spotify: "37i9dQZF1DWZeKCadgRdKQ" },
			songs: [
				{
					title: "Strobe",
					artists: ["deadmau5"],
					album: "For Lack of a Better Name",
					date: "2009-09-22",
					durationMs: 637000,
				},
				{ title: "Ghosts 'n' Stuff", artists: ["deadmau5", "Rob Swire"], date: "2008" },
			],
		},
		{ name: "Nothing yet", songs: [] },
		{
			name: "Running",
			description: "Fast ones",
			songs: [
				{ title: "Midnight City", artists: ["M83"], explicit: false },
				{ title: "Untagged", artists: [], location: "file:///music/untagged.mp3" },
			],
		},
	],
} satisfies SongDictInput;

const handshake = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	version: z.string().min(1),
	mode: z.array(Mode).min(1),
	components: z.array(Component).min(1),
});

/** Builtins structured clone carries with their prototype; typed arrays are checked apart. */
const cloneablePrototypes = new Set<unknown>([
	Object.prototype,
	Array.prototype,
	null,
	Date.prototype,
	RegExp.prototype,
	Map.prototype,
	Set.prototype,
	ArrayBuffer.prototype,
	Error.prototype,
	Boolean.prototype,
	Number.prototype,
	String.prototype,
	Blob.prototype,
]);

function keepsItsPrototype(value: object): boolean {
	return cloneablePrototypes.has(Object.getPrototypeOf(value)) || ArrayBuffer.isView(value);
}

/** Every value inside `value`, with its path, depth first. */
function* walk(value: unknown, path: IssuePath = []): Generator<[unknown, IssuePath]> {
	yield [value, path];
	if (typeof value !== "object" || value === null) return;
	const entries =
		value instanceof Map || value instanceof Set || Array.isArray(value)
			? [...value.entries()]
			: Object.entries(value);
	for (const [key, item] of entries) {
		yield* walk(item, [
			...path,
			typeof key === "number" || typeof key === "string" ? key : String(key),
		]);
	}
}

/** The structured-clone half of the boundary check: what a `postMessage` would refuse. */
function cloneFailures(value: unknown, path: IssuePath): ConformanceFailure[] {
	try {
		structuredClone(value);
		return [];
	} catch (error) {
		const found = [...walk(value)].find(
			([item]) => typeof item === "function" || typeof item === "symbol",
		);
		return [
			{
				invariant: "clone-boundary",
				path: [...path, ...(found?.[1] ?? [])],
				message: `Cannot cross the plugin boundary: ${String(error)}`,
			},
		];
	}
}

/** The other half: a class instance clones silently into a method-less husk (ADR-0010 §5). */
function lostMethodFailures(value: unknown, path: IssuePath): ConformanceFailure[] {
	return [...walk(value)]
		.filter(([item]) => typeof item === "object" && item !== null && !keepsItsPrototype(item))
		.map(([item, itemPath]) => ({
			invariant: "lost-methods" as const,
			path: [...path, ...itemPath],
			message: `A ${(item as object).constructor?.name ?? "class"} instance loses its methods across the boundary`,
		}));
}

function boundaryFailures(value: unknown, path: IssuePath): ConformanceFailure[] {
	return [...cloneFailures(value, path), ...lostMethodFailures(value, path)];
}

/** The first path at which two plain-data values differ, if any. */
function firstDifference(
	before: unknown,
	after: unknown,
	path: IssuePath = [],
): IssuePath | undefined {
	if (Object.is(before, after)) return undefined;
	if (
		typeof before !== "object" ||
		typeof after !== "object" ||
		before === null ||
		after === null
	) {
		return path;
	}
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const key of keys) {
		const at = Array.isArray(before) ? Number(key) : key;
		const difference = firstDifference(
			(before as Record<string, unknown>)[key],
			(after as Record<string, unknown>)[key],
			[...path, at],
		);
		if (difference) return difference;
	}
	return undefined;
}

function issuePath(path: PropertyKey[]): IssuePath {
	return path.map((key) => (typeof key === "symbol" ? String(key) : key));
}

/** Parses each fixture value, returning the first valid one parsed, if it parses. */
function checkSettingsFixture(
	schema: z.ZodType,
	fixture: SettingsFixture<unknown>,
	path: IssuePath,
	failures: ConformanceFailure[],
): Record<string, unknown> | undefined {
	let first: Record<string, unknown> | undefined;
	for (const [index, value] of fixture.valid.entries()) {
		const result = schema.safeParse(value);
		if (result.success) {
			if (index === 0) first = result.data as Record<string, unknown>;
			continue;
		}
		for (const issue of result.error.issues) {
			failures.push({
				invariant: "settings-fixtures",
				path: [...path, "valid", index, ...issuePath(issue.path)],
				message: issue.message,
			});
		}
	}
	for (const [index, value] of fixture.invalid.entries()) {
		if (schema.safeParse(value).success) {
			failures.push({
				invariant: "settings-fixtures",
				path: [...path, "invalid", index],
				message: "A known-bad value parsed",
			});
		}
	}
	return first;
}

function staticFailures(plugin: Plugin): ConformanceFailure[] {
	const failures: ConformanceFailure[] = [];

	const shape = handshake.safeParse(plugin);
	if (!shape.success) {
		for (const issue of shape.error.issues) {
			failures.push({
				invariant: "handshake",
				path: issuePath(issue.path),
				message: issue.message,
			});
		}
	}
	for (const [key, handler] of Object.entries(plugin.run)) {
		if (typeof handler !== "function") {
			failures.push({ invariant: "handshake", path: ["run", key], message: "Expected a function" });
		}
	}
	if (plugin.test !== undefined && typeof plugin.test !== "function") {
		failures.push({ invariant: "handshake", path: ["test"], message: "Expected a function" });
	}

	const handlerKeys = Object.keys(plugin.run);
	const settingsKeys = Object.keys(plugin.instanceSettings);
	for (const key of handlerKeys) {
		if (!Component.safeParse(key).success) {
			failures.push({ invariant: "key-parity", path: ["run", key], message: "Not a component" });
		} else if (!settingsKeys.includes(key)) {
			failures.push({
				invariant: "key-parity",
				path: ["run", key],
				message: "A handler with no instanceSettings schema",
			});
		}
	}
	for (const key of settingsKeys.filter((key) => !handlerKeys.includes(key))) {
		failures.push({
			invariant: "key-parity",
			path: ["instanceSettings", key],
			message: "A settings schema with no handler",
		});
	}

	const forms: [z.ZodType | undefined, IssuePath, boolean][] = [
		[plugin.persistentSettings, ["persistentSettings"], false],
		...Object.entries(plugin.instanceSettings).map(
			([key, schema]): [z.ZodType | undefined, IssuePath, boolean] => [
				schema,
				["instanceSettings", key],
				false,
			],
		),
		[plugin.auth?.fields, ["auth", "fields"], true],
	];
	for (const [schema, path, auth] of forms) {
		if (schema === undefined) continue;
		const result = toFormSchema(schema, { auth });
		if (result.ok) continue;
		for (const issue of result.issues) {
			failures.push({
				invariant: "renderable-subset",
				path: [...path, ...issue.path],
				message: issue.message,
			});
		}
	}

	if (plugin.auth !== undefined && !Service.safeParse(plugin.auth.service).success) {
		failures.push({
			invariant: "known-service",
			path: ["auth", "service"],
			message: `"${plugin.auth.service}" is not in services; add it there, or fix the typo`,
		});
	}
	return failures;
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : JSON.stringify(error);
}

/**
 * Checks a plugin against every invariant, calling its real handlers with stub contexts built by
 * the runner's own harness. The plugin's test file stubs the network.
 */
export async function checkConformance<P extends Plugin>(
	plugin: P,
	fixtures: ConformanceFixtures<P>,
): Promise<ConformanceFailure[]> {
	const failures = staticFailures(plugin);

	let persistent: Record<string, unknown> | undefined = {};
	if (plugin.persistentSettings !== undefined) {
		persistent = fixtures.persistentSettings
			? checkSettingsFixture(
					plugin.persistentSettings,
					fixtures.persistentSettings,
					["persistentSettings"],
					failures,
				)
			: undefined;
		if (!fixtures.persistentSettings) {
			failures.push({
				invariant: "settings-fixtures",
				path: ["persistentSettings"],
				message: "No fixture for the declared persistentSettings",
			});
		}
	}

	const instances = new Map<Component, Record<string, unknown>>();
	const instanceFixtures: Partial<Record<string, SettingsFixture<unknown>>> =
		fixtures.instanceSettings;
	for (const [key, schema] of Object.entries(plugin.instanceSettings)) {
		const fixture = instanceFixtures[key];
		if (fixture === undefined) {
			failures.push({
				invariant: "settings-fixtures",
				path: ["instanceSettings", key],
				message: "No fixture for this component's instanceSettings",
			});
			continue;
		}
		const parsed = checkSettingsFixture(schema, fixture, ["instanceSettings", key], failures);
		const component = Component.safeParse(key);
		if (parsed && component.success) instances.set(component.data, parsed);
	}

	const songs = SongDict.safeParse(fixtures.songs ?? defaultSongDict);
	if (!songs.success) {
		failures.push({
			invariant: "settings-fixtures",
			path: ["songs"],
			message: "The fixture song dict does not parse",
		});
	}

	let credentials: unknown;
	if (plugin.auth !== undefined) {
		const parsed = plugin.auth.fields.safeParse(fixtures.credentials ?? {});
		if (parsed.success) credentials = parsed.data;
		else {
			for (const issue of parsed.error.issues) {
				failures.push({
					invariant: "settings-fixtures",
					path: ["credentials", ...issuePath(issue.path)],
					message: issue.message,
				});
			}
		}
	}

	const logs: unknown[] = [];
	const port: HostPort = {
		credentials: () =>
			plugin.auth === undefined || credentials === undefined
				? Promise.reject(new Error("This plugin has no credentials fixture"))
				: Promise.resolve(structuredClone(credentials)),
		log: (entry) => logs.push(entry),
	};
	const configDir = mkdtempSync(join(tmpdir(), `ultrasonics-conformance-${plugin.name}-`));

	if (persistent !== undefined && songs.success) {
		for (const component of plugin.components) {
			const handler = plugin.run[component];
			const instance = instances.get(component);
			if (typeof handler !== "function" || instance === undefined) continue;

			const fields = {
				appletId: "conformance-applet",
				runId: `conformance-${component}`,
				deadlineMs: Date.now() + 60_000,
				configDir,
				persistent,
				instance,
			};
			const payload: RunPayload =
				component === "inputs"
					? { component, ...fields }
					: { component, ...fields, songs: structuredClone(songs.data) };
			failures.push(...boundaryFailures(payload, ["payload", component]));
			const before = structuredClone(payload);
			const path: IssuePath = ["run", component];

			let result: unknown;
			try {
				result = await plugin.run[component]?.(createRunContext(payload, port));
			} catch (error) {
				failures.push({
					invariant: component === "outputs" ? "output-completeness" : "valid-song-dict",
					path,
					message: `The handler threw: ${describeError(error)}`,
				});
				continue;
			}
			failures.push(...boundaryFailures(result, path));

			if (component === "outputs") {
				failures.push(
					...outputFailures(result, before.component === "inputs" ? undefined : before.songs),
				);
				if (before.component !== "inputs" && payload.component !== "inputs") {
					const changed = firstDifference(before.songs, payload.songs);
					if (changed) {
						failures.push({
							invariant: "output-immutability",
							path: [...path, "songs", ...changed],
							message: "An output changed the song dict it received",
						});
					}
				}
			} else {
				const validation = validateSongDict(result, { strict: true });
				for (const issue of validation.ok ? [] : validation.issues) {
					failures.push({
						invariant: "valid-song-dict",
						path: [...path, ...issue.path],
						message: issue.message,
					});
				}
			}
		}
	}

	if (typeof plugin.test === "function" && persistent !== undefined) {
		try {
			const result = await plugin.test(createTestContext({ persistent, configDir }, port));
			const parsed = TestResult.safeParse(result);
			for (const issue of parsed.success ? [] : parsed.error.issues) {
				failures.push({
					invariant: "test-result",
					path: ["test", ...issuePath(issue.path)],
					message: issue.message,
				});
			}
		} catch (error) {
			failures.push({
				invariant: "test-result",
				path: ["test"],
				message: `test() threw rather than returning a TestResult: ${describeError(error)}`,
			});
		}
	}

	rmSync(configDir, { recursive: true, force: true });
	return failures;
}

/** Every playlist received appears exactly once, by position, with unmatched songs in range. */
function outputFailures(result: unknown, songs: SongDict | undefined): ConformanceFailure[] {
	const path: IssuePath = ["run", "outputs"];
	const fail = (at: IssuePath, message: string): ConformanceFailure => ({
		invariant: "output-completeness",
		path: [...path, ...at],
		message,
	});
	const parsed = OutputResult.safeParse(result);
	if (!parsed.success) {
		return parsed.error.issues.map((issue) => fail(issuePath(issue.path), issue.message));
	}

	const playlists = songs?.playlists ?? [];
	const failures: ConformanceFailure[] = [];
	const seen = new Set<number>();
	for (const [index, entry] of parsed.data.playlists.entries()) {
		const playlist = playlists[entry.playlist];
		if (playlist === undefined) {
			failures.push(
				fail(["playlists", index, "playlist"], `No playlist at position ${entry.playlist}`),
			);
			continue;
		}
		if (seen.has(entry.playlist)) {
			failures.push(
				fail(["playlists", index, "playlist"], `Playlist ${entry.playlist} appears twice`),
			);
		}
		seen.add(entry.playlist);
		if (entry.status !== "written") continue;
		for (const [position, song] of entry.unmatched.entries()) {
			if (song < 0 || song >= playlist.songs.length) {
				failures.push(
					fail(["playlists", index, "unmatched", position], `No song at position ${song}`),
				);
			}
		}
	}
	for (const position of playlists.keys()) {
		if (!seen.has(position)) {
			failures.push(fail(["playlists", position], `Playlist ${position} has no entry`));
		}
	}
	return failures;
}

/**
 * Registers a `bun:test` suite for a plugin: one test per invariant, each failure naming its path.
 * Call it from the plugin's own test file.
 */
export function runConformance<P extends Plugin>(
	plugin: P,
	fixtures: ConformanceFixtures<P>,
): void {
	let checked: Promise<ConformanceFailure[]> | undefined;
	const failures = () => {
		checked ??= checkConformance(plugin, fixtures);
		return checked;
	};
	for (const invariant of invariants) {
		test(`conformance: ${plugin.name} satisfies ${invariant}`, async () => {
			const broken = (await failures())
				.filter((failure) => failure.invariant === invariant)
				.map((failure) => `${failure.path.join(".") || "(root)"}: ${failure.message}`);
			expect(broken).toEqual([]);
		});
	}
}
