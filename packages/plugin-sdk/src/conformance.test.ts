import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { examplePlugin } from "../test/example-plugin.ts";
import {
	type ConformanceFixtures,
	checkConformance,
	defaultSongDict,
	type Invariant,
	invariants,
	runConformance,
} from "./conformance.ts";
import { type OutputResult, type Plugin, type Service, validateSongDict } from "./index.ts";

const exampleFixtures: ConformanceFixtures<typeof examplePlugin> = {
	persistentSettings: { valid: [{}, { prefix: "ultrasonics: " }], invalid: [{ prefix: 3 }] },
	instanceSettings: {
		inputs: {
			valid: [{ mode: "playlists", names: "Focus, Running" }, { mode: "saved" }],
			invalid: [{ mode: "liked" }, { mode: "playlists", names: "" }],
		},
		modifiers: { valid: [{}], invalid: [{ suffix: false }] },
		outputs: { valid: [{ existing: "update" }], invalid: [{ existing: "replace" }] },
	},
	credentials: { serverUrl: "https://plex.example", token: "secret" },
};

runConformance(examplePlugin, exampleFixtures);

const run = examplePlugin.run;

async function writeAll(songs: Parameters<NonNullable<Plugin["run"]["outputs"]>>[0]["songs"]) {
	return {
		playlists: (songs?.playlists ?? []).map((_, playlist) => ({
			status: "written" as const,
			playlist,
			unmatched: [],
		})),
	} satisfies OutputResult;
}

class PlaylistReport {}

/** One plugin per invariant, each broken in exactly the way that invariant exists to catch. */
const broken: [Invariant, Plugin, ConformanceFixtures<Plugin>, (string | number)[]][] = [
	["handshake", { ...examplePlugin, name: "" }, exampleFixtures, ["name"]],
	[
		"settings-fixtures",
		examplePlugin,
		{
			...exampleFixtures,
			instanceSettings: {
				...exampleFixtures.instanceSettings,
				outputs: { valid: [{}], invalid: [{ existing: "append" }] },
			},
		},
		["instanceSettings", "outputs", "invalid", 0],
	],
	[
		"key-parity",
		{
			...examplePlugin,
			instanceSettings: {
				inputs: examplePlugin.instanceSettings.inputs,
				modifiers: examplePlugin.instanceSettings.modifiers,
			},
		},
		exampleFixtures,
		["run", "outputs"],
	],
	[
		"clone-boundary",
		{
			...examplePlugin,
			run: {
				...run,
				outputs: async (ctx) => ({ ...(await writeAll(ctx.songs)), onDone() {} }),
			},
		},
		exampleFixtures,
		["run", "outputs", "onDone"],
	],
	[
		"lost-methods",
		{
			...examplePlugin,
			run: {
				...run,
				async outputs(ctx) {
					const result = await writeAll(ctx.songs);
					const [first, ...rest] = result.playlists;
					return { playlists: [Object.assign(new PlaylistReport(), first), ...rest] };
				},
			},
		},
		exampleFixtures,
		["run", "outputs", "playlists", 0],
	],
	[
		"renderable-subset",
		{
			...examplePlugin,
			instanceSettings: {
				...examplePlugin.instanceSettings,
				outputs: z.object({ tags: z.array(z.string()).optional() }),
			},
		},
		exampleFixtures,
		["instanceSettings", "outputs", "tags"],
	],
	[
		"output-completeness",
		{
			...examplePlugin,
			run: {
				...run,
				async outputs(ctx) {
					const { playlists } = await writeAll(ctx.songs);
					return { playlists: playlists.slice(1) };
				},
			},
		},
		exampleFixtures,
		["run", "outputs", "playlists"],
	],
	[
		"valid-song-dict",
		{
			...examplePlugin,
			run: {
				...run,
				inputs: async () => ({
					playlists: [{ name: "Focus", songs: [{ title: "", artists: [] }] }],
				}),
			},
		},
		exampleFixtures,
		["run", "inputs", "playlists", 0, "songs", 0, "title"],
	],
	[
		"known-service",
		// A cast, because the compiler already rejects this break; conformance is the second line.
		{
			...examplePlugin,
			auth: {
				service: "spotfy" as Service,
				flow: "token",
				fields: z.object({ token: z.string() }),
			},
		},
		exampleFixtures,
		["auth", "service"],
	],
	[
		"output-immutability",
		{
			...examplePlugin,
			run: {
				...run,
				async outputs(ctx) {
					const first = ctx.songs?.playlists[0];
					if (first) first.name = "Renamed";
					return writeAll(ctx.songs);
				},
			},
		},
		exampleFixtures,
		["run", "outputs", "songs", "playlists", 0, "name"],
	],
	[
		"test-result",
		{
			...examplePlugin,
			test: async () => ({ ok: false, code: "expired", message: "x" }) as never,
		},
		exampleFixtures,
		["test", "code"],
	],
];

describe("checkConformance", () => {
	test("passes the example plugin", async () => {
		expect(await checkConformance(examplePlugin, exampleFixtures)).toEqual([]);
	});

	test("has a broken plugin for every invariant", () => {
		expect(broken.map(([invariant]) => invariant).sort()).toEqual([...invariants].sort());
	});

	test.each(broken)(
		"fails a plugin that breaks %s, naming the path",
		async (invariant, plugin, fixtures, path) => {
			const failures = await checkConformance(plugin, fixtures);
			expect(failures).toContainEqual({ invariant, path, message: expect.any(String) });
		},
	);

	test("names a handler that throws", async () => {
		const throwing: Plugin = {
			...examplePlugin,
			run: { ...run, inputs: () => Promise.reject(new Error("401 Unauthorised")) },
		};
		const failures = await checkConformance<Plugin>(throwing, exampleFixtures);
		expect(failures).toContainEqual({
			invariant: "valid-song-dict",
			path: ["run", "inputs"],
			message: expect.stringContaining("401 Unauthorised"),
		});
	});

	test("fails an output that reports a song unmatched twice, as the runner would", async () => {
		const repeating: Plugin = {
			...examplePlugin,
			run: {
				...run,
				async outputs(ctx) {
					const { playlists } = await writeAll(ctx.songs);
					return { playlists: playlists.map((entry) => ({ ...entry, unmatched: [0, 0] })) };
				},
			},
		};
		const first = defaultSongDict.playlists.findIndex((playlist) => playlist.songs.length > 0);
		const failures = await checkConformance<Plugin>(repeating, exampleFixtures);
		expect(failures).toContainEqual({
			invariant: "output-completeness",
			path: ["run", "outputs", "playlists", first, "unmatched", 1],
			message: expect.any(String),
		});
	});

	test("requires a fixture for every component's settings", async () => {
		const { outputs: _, ...instanceSettings } = exampleFixtures.instanceSettings;
		const failures = await checkConformance<Plugin>(examplePlugin, {
			...exampleFixtures,
			instanceSettings: instanceSettings as ConformanceFixtures<Plugin>["instanceSettings"],
		});
		expect(failures).toContainEqual({
			invariant: "settings-fixtures",
			path: ["instanceSettings", "outputs"],
			message: expect.any(String),
		});
	});
});

describe("defaultSongDict", () => {
	test("is strictly valid, with several playlists and an empty one among them", () => {
		expect(validateSongDict(defaultSongDict, { strict: true }).ok).toBe(true);
		expect(defaultSongDict.playlists.length).toBeGreaterThanOrEqual(3);
		expect(defaultSongDict.playlists.some((playlist) => playlist.songs.length === 0)).toBe(true);
	});
});
