import { describe, expect, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import { examplePlugin } from "../test/example-plugin.ts";
import {
	defineAuth,
	definePlugin,
	OutputResult,
	type Plugin,
	type PluginRegistry,
	type SongDict,
	TestResult,
} from "./index.ts";

const handshake = {
	name: "probe",
	description: "Probes the types",
	version: "1.0.0",
	mode: ["songs"],
} as const;

const emptyOutput = { playlists: [] };

describe("definePlugin", () => {
	test("derives components from run, with no component field (ADR-0012 §3)", () => {
		expect(examplePlugin.components).toEqual(["inputs", "modifiers", "outputs"]);
		expect(examplePlugin).not.toHaveProperty("component");

		const outputOnly = definePlugin({
			...handshake,
			instanceSettings: { outputs: z.object({}) },
			run: { outputs: async () => emptyOutput },
		});
		expect(outputOnly.components).toEqual(["outputs"]);
	});

	test("types each handler's context from its own component's schema", () => {
		definePlugin({
			...handshake,
			auth: defineAuth({ service: "spotify", flow: "oauth2", scopes: [] }),
			persistentSettings: z.object({ market: z.string().default("AU") }),
			instanceSettings: {
				inputs: z.object({ playlist: z.string() }),
				outputs: z.object({ existing: z.enum(["append", "update"]).default("append") }),
			},
			run: {
				async inputs(ctx) {
					expectTypeOf(ctx.instance).toEqualTypeOf<{ playlist: string }>();
					expectTypeOf(ctx.persistent).toEqualTypeOf<{ market: string }>();
					expectTypeOf(await ctx.auth.get()).toEqualTypeOf<{ accessToken: string }>();
					expectTypeOf(ctx.auth.get).parameters.toEqualTypeOf<[]>();
					expectTypeOf(ctx.log.info).returns.toEqualTypeOf<void>();
					expectTypeOf(ctx).toHaveProperty("runId").toEqualTypeOf<string>();
					expectTypeOf(ctx).toHaveProperty("appletId").toEqualTypeOf<string>();
					expectTypeOf(ctx).toHaveProperty("deadlineMs").toEqualTypeOf<number>();
					expectTypeOf(ctx).toHaveProperty("configDir").toEqualTypeOf<string>();
					// @ts-expect-error -- an input receives no song dict (ADR-0012 §2)
					ctx.songs;
					return { playlists: [] };
				},
				async outputs(ctx) {
					expectTypeOf(ctx.instance).toEqualTypeOf<{ existing: "append" | "update" }>();
					expectTypeOf(ctx.songs).toEqualTypeOf<SongDict>();
					return emptyOutput;
				},
			},
		});
	});

	test("gives a plugin without auth no ctx.auth, and an empty persistent object", () => {
		definePlugin({
			...handshake,
			instanceSettings: { modifiers: z.object({}) },
			run: {
				async modifiers(ctx) {
					// @ts-expect-error -- a plugin that declares no auth has no ctx.auth
					ctx.auth;
					expectTypeOf(ctx.persistent).toEqualTypeOf<Record<string, never>>();
					return ctx.songs;
				},
			},
		});
	});

	test("gives test() persistent settings and auth, but no instance settings", () => {
		definePlugin({
			...handshake,
			auth: defineAuth({ service: "plex", flow: "token", fields: z.object({ token: z.string() }) }),
			instanceSettings: { inputs: z.object({}) },
			run: { inputs: async () => ({ playlists: [] }) },
			async test(ctx) {
				expectTypeOf(await ctx.auth.get()).toEqualTypeOf<{ token: string }>();
				// @ts-expect-error -- test() runs before any applet exists
				ctx.instance;
				return { ok: true };
			},
		});
	});

	test("rejects contract breaks at compile time", () => {
		definePlugin({
			...handshake,
			instanceSettings: { inputs: z.object({}) },
			// @ts-expect-error -- an input that returns nothing
			run: { async inputs() {} },
		});
		definePlugin({
			...handshake,
			instanceSettings: { outputs: z.object({}) },
			// @ts-expect-error -- an output must return an OutputResult (ADR-0020)
			run: { async outputs() {} },
		});
		definePlugin({
			...handshake,
			instanceSettings: { outputs: z.object({}) },
			// @ts-expect-error -- an output must report by position, not by name
			run: { outputs: async () => ({ playlists: [{ status: "written", playlist: "Focus" }] }) },
		});
		definePlugin({
			...handshake,
			instanceSettings: { inputs: z.object({}) },
			// @ts-expect-error -- a handler with no settings schema would never be dispatched
			run: { inputs: async () => ({ playlists: [] }), outputs: async () => emptyOutput },
		});
		definePlugin({
			...handshake,
			instanceSettings: { inputs: z.object({}), outputs: z.object({}) },
			// @ts-expect-error -- a settings schema for a component the plugin does not implement
			run: { inputs: async () => ({ playlists: [] }) },
		});
		const dynamic = {
			...handshake,
			instanceSettings: () => ({ inputs: z.object({}) }),
			run: { inputs: async () => ({ playlists: [] }) },
		};
		// @ts-expect-error -- instanceSettings is a static record, never a function (ADR-0012 §1)
		definePlugin(dynamic);
	});
});

describe("PluginRegistry", () => {
	test("maps a plugin name to its path and loader (ADR-0012 §4)", async () => {
		const registry = {
			example: {
				path: "@ultrasonics/plugin-sdk/test/example-plugin",
				load: async () => ({ default: examplePlugin }),
			},
		} as const satisfies PluginRegistry;
		const loaded: Plugin = (await registry.example.load()).default;
		expect(loaded.name).toBe("example");
	});
});

describe("TestResult", () => {
	test.each([
		{ ok: true },
		{ ok: false, code: "invalid-credentials", message: "The token expired" },
		{ ok: false, code: "unreachable", message: "No answer from the server" },
		{ ok: false, code: "misconfigured", message: "No library selected" },
	])("accepts %p", (result) => {
		expect(TestResult.safeParse(result).success).toBe(true);
	});

	test.each<object>([{ ok: false, code: "expired", message: "x" }, { ok: false }, {}])(
		"rejects %p",
		(result) => {
			expect(TestResult.safeParse(result).success).toBe(false);
		},
	);
});

describe("OutputResult (ADR-0020 §1)", () => {
	test("accepts one entry per playlist in each status", () => {
		const result: OutputResult = {
			playlists: [
				{ status: "written", playlist: 0, unmatched: [2, 5] },
				{ status: "skipped", playlist: 1, code: "empty", message: "Nothing to write" },
				{ status: "failed", playlist: 2, code: "http-500", message: "Plex refused the write" },
			],
		};
		expect(OutputResult.parse(result)).toEqual(result);
	});

	test.each([
		["a written playlist without unmatched", { status: "written", playlist: 0 }],
		["a skip without a reason", { status: "skipped", playlist: 0 }],
		["a fractional position", { status: "failed", playlist: 0.5, code: "x", message: "y" }],
		["an unknown status", { status: "done", playlist: 0 }],
	])("rejects %s", (_, entry) => {
		expect(OutputResult.safeParse({ playlists: [entry] }).success).toBe(false);
	});
});
