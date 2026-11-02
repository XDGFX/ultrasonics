import { describe, expect, test } from "bun:test";
import type { AppletDefinition, Slot } from "@ultrasonics/db";
import type { AuthFailure, AuthProvider, SongDictInput } from "@ultrasonics/plugin-sdk";
import { fixturePlugins } from "../test/fixture-plugins.ts";
import { RunEvent } from "./run-event.ts";
import {
	REJECTIONS_EMITTED_PER_STAGE,
	RUN_DEADLINE_MS,
	type RunCapabilities,
	runApplet,
} from "./runner.ts";

const song = (title: string) => ({ title, artists: ["Artist"] });
const dict = (...playlists: [string, string[]][]): SongDictInput => ({
	playlists: playlists.map(([name, titles]) => ({ name, songs: titles.map(song) })),
});
const echo = (returns: unknown): Slot => ({ plugin: "echo", settings: { returns } });
const slot = (plugin: string, settings: unknown = {}): Slot => ({ plugin, settings });

/** A fake account-bound provider: resolves the given credentials, or rejects with the failure. */
function fakeAuth(answer: { credentials: unknown } | { failure: AuthFailure }): AuthProvider {
	const unused = () => Promise.reject(new Error("not used by the runner"));
	return {
		requirements: () => [],
		resolve: () =>
			"failure" in answer
				? Promise.reject(answer.failure)
				: Promise.resolve(answer.credentials as Record<string, never>),
		configure: unused,
		begin: unused,
		complete: unused,
	};
}

interface RunOptions {
	capabilities?: Partial<RunCapabilities>;
	now?: () => number;
}

async function run(definition: AppletDefinition, options: RunOptions = {}) {
	const fixtures = fixturePlugins();
	const events: RunEvent[] = [];
	const status = await runApplet({
		runId: "run-1",
		applet: { id: "applet-1", name: "Weekly sync", definition },
		trigger: "manual",
		registry: fixtures.registry,
		capabilities: {
			auth: fakeAuth({ credentials: { token: "secret" } }),
			persistentSettings: async () => undefined,
			configDir: (plugin) => `/config/${plugin}`,
			...options.capabilities,
		},
		events: { emit: (event) => events.push(event) },
		...(options.now ? { now: options.now } : {}),
	});
	const ofType = <T extends RunEvent["type"]>(type: T) =>
		events.filter((event): event is Extract<RunEvent, { type: T }> => event.type === type);
	const finished = ofType("stage").filter((stage) => stage.state === "finished");
	return { status, events, ofType, finished, ...fixtures };
}

describe("runApplet: order", () => {
	test("concatenates inputs in order, then applies modifiers in order", async () => {
		const { status, received } = await run({
			inputs: [echo(dict(["A", ["a"]])), echo(dict(["B", ["b"]], ["C", []]))],
			modifiers: [slot("suffix", { suffix: "-1" }), slot("suffix", { suffix: "-2" })],
			outputs: [slot("writer")],
		});

		expect(status).toBe("succeeded");
		expect(received.writer?.[0]?.playlists.map((p) => p.name)).toEqual(["A-1-2", "B-1-2", "C-1-2"]);
	});

	test("gives each output its own copy, so a mutating output cannot change the next", async () => {
		const { received } = await run({
			inputs: [echo(dict(["A", ["a", "b"]]))],
			modifiers: [],
			outputs: [slot("vandal"), slot("writer")],
		});

		expect(received.writer?.[0]?.playlists[0]?.songs.map((s) => s.title)).toEqual(["a", "b"]);
	});
});

describe("runApplet: outcome", () => {
	const twoSongs = echo(dict(["A", ["a", "b"]]));
	const withBadSong = echo({ playlists: [{ name: "A", songs: [song("a"), { title: "" }] }] });
	const allBad = echo({ playlists: [{ name: "", songs: [] }] });

	test.each([
		["empty input", [echo(dict())], [slot("writer")], "succeeded"],
		["unmatched songs", [twoSongs], [slot("writer", { unmatched: [0, 1] })], "succeeded"],
		["one output wrote and one threw", [twoSongs], [slot("writer"), slot("thrower")], "partial"],
		["a rejection with something written", [withBadSong], [slot("writer")], "partial"],
		["a rejection with nothing written", [allBad], [slot("writer")], "failed"],
		["every output threw", [twoSongs], [slot("thrower"), slot("thrower")], "failed"],
		["every playlist refused", [twoSongs], [slot("refused")], "failed"],
		[
			"one output wrote and one was refused",
			[twoSongs],
			[slot("writer"), slot("refused")],
			"partial",
		],
		["an input threw", [twoSongs, slot("thrower")], [slot("writer")], "failed"],
	] as const)("%s → %s", async (_, inputs, outputs, expected) => {
		const { status, ofType } = await run({
			inputs: [...inputs],
			modifiers: [],
			outputs: [...outputs],
		});

		expect(status).toBe(expected);
		expect(ofType("end")).toEqual([expect.objectContaining({ status: expected })]);
	});

	test("an input that throws stops the run before any output", async () => {
		const { calls, finished } = await run({
			inputs: [slot("thrower")],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(calls).toEqual(["thrower"]);
		expect(finished[0]?.error).toMatchObject({ code: "threw", message: "input broke" });
	});

	test("a modifier that throws stops the run there", async () => {
		const { status, calls } = await run({
			inputs: [echo(dict(["A", ["a"]]))],
			modifiers: [slot("thrower"), slot("suffix", { suffix: "!" })],
			outputs: [slot("writer")],
		});

		expect(status).toBe("failed");
		expect(calls).toEqual(["echo", "thrower"]);
	});

	test("an output that throws does not stop the outputs after it", async () => {
		const { calls } = await run({
			inputs: [echo(dict(["A", ["a"]]))],
			modifiers: [],
			outputs: [slot("thrower"), slot("writer")],
		});

		expect(calls).toEqual(["echo", "thrower", "writer"]);
	});
});

describe("runApplet: preparation", () => {
	test.each([
		["unknown-plugin", slot("gone")],
		["missing-component", slot("writer")],
		["settings-invalid", slot("configured", { limit: "ten" })],
	] as const)("%s fails the run before any handler is called", async (code, broken) => {
		const { status, calls, finished } = await run({
			inputs: [echo(dict(["A", ["a"]])), broken],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(status).toBe("failed");
		expect(calls).toEqual([]);
		expect(finished).toEqual([
			expect.objectContaining({
				component: "inputs",
				index: 1,
				error: expect.objectContaining({ code }),
			}),
		]);
	});

	test("a registered plugin that fails to load reports the load error, not an unknown plugin", async () => {
		const { status, calls, finished } = await run({
			inputs: [slot("unloadable")],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(status).toBe("failed");
		expect(calls).toEqual([]);
		expect(finished).toEqual([
			expect.objectContaining({
				error: expect.objectContaining({
					code: "threw",
					message: expect.stringContaining("Cannot find module 'left-pad'"),
				}),
			}),
		]);
	});

	test("a persistent-settings lookup that throws fails the run with an error log", async () => {
		const { status, calls, ofType } = await run(
			{ inputs: [echo(dict(["A", ["a"]]))], modifiers: [], outputs: [slot("writer")] },
			{
				capabilities: {
					persistentSettings: () => Promise.reject(new Error("database is locked")),
				},
			},
		);

		expect(status).toBe("failed");
		expect(calls).toEqual([]);
		expect(ofType("log")).toContainEqual(
			expect.objectContaining({
				level: "error",
				text: expect.stringContaining("database is locked"),
			}),
		);
		expect(ofType("end")).toEqual([expect.objectContaining({ status: "failed" })]);
	});

	test("invalid settings name the fields, persistent and instance", async () => {
		const { finished } = await run({
			inputs: [slot("configured", { limit: "ten" })],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(finished[0]?.error?.message).toContain("instance.limit");
		expect(finished[0]?.error?.message).toContain("persistent.server");
	});

	test("valid settings reach the plugin parsed, with its configDir", async () => {
		const { received } = await run(
			{ inputs: [slot("configured")], modifiers: [], outputs: [slot("writer")] },
			{
				capabilities: {
					persistentSettings: async (plugin) =>
						plugin === "configured" ? { server: "plex" } : undefined,
				},
			},
		);

		expect(received.writer?.[0]?.playlists[0]?.name).toBe("plex:10:/config/configured");
	});
});

describe("runApplet: validation", () => {
	test("drops a bad song but keeps its playlist, and drops a bad playlist", async () => {
		const { received, ofType, finished } = await run({
			inputs: [
				echo({
					playlists: [
						{ name: "Kept", songs: [song("a"), { title: "", artists: [] }] },
						{ name: "", songs: [song("b")] },
					],
				}),
			],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(received.writer?.[0]?.playlists.map((p) => p.songs.map((s) => s.title))).toEqual([
			["a"],
		]);
		expect(ofType("rejection")).toEqual([
			expect.objectContaining({ plugin: "echo", component: "inputs", playlist: 0, song: 1 }),
			expect.objectContaining({ plugin: "echo", component: "inputs", playlist: 1 }),
		]);
		expect(ofType("rejection")[1]).not.toHaveProperty("song");
		expect(finished[0]).toMatchObject({ songs: 1, playlists: 1, rejected: 2 });
	});

	test("emits at most the capped number of rejections, with the full count on the stage", async () => {
		const total = REJECTIONS_EMITTED_PER_STAGE + 7;
		const songs = Array.from({ length: total }, () => ({ title: "" }));
		const { ofType, finished } = await run({
			inputs: [echo({ playlists: [{ name: "A", songs }] })],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(ofType("rejection")).toHaveLength(REJECTIONS_EMITTED_PER_STAGE);
		expect(finished[0]?.rejected).toBe(total);
	});

	test("strips unknown keys with one warning per plugin naming them", async () => {
		const extra = { ...song("a"), duration: 1, mood: "calm" };
		const { received, ofType } = await run({
			inputs: [echo({ playlists: [{ name: "A", songs: [extra, extra] }] })],
			modifiers: [],
			outputs: [slot("writer")],
		});

		const warnings = ofType("log").filter((line) => line.level === "warn");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.text).toContain("duration");
		expect(warnings[0]?.text).toContain("mood");
		expect(received.writer?.[0]?.playlists[0]?.songs[0]).not.toHaveProperty("duration");
	});

	test("warns about stripped keys once per plugin, though it fills two slots", async () => {
		const extra = { ...song("a"), duration: 1 };
		const { ofType } = await run({
			inputs: [
				echo({ playlists: [{ name: "A", songs: [extra] }] }),
				echo({ playlists: [{ name: "B", songs: [extra] }] }),
			],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(ofType("log").filter((line) => line.level === "warn")).toHaveLength(1);
	});

	test("a return that is not a song dict is a contract error", async () => {
		const { status, finished } = await run({
			inputs: [echo([song("a")])],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(status).toBe("failed");
		expect(finished[0]?.error?.code).toBe("contract");
	});
});

describe("runApplet: outputs", () => {
	const twoPlaylists = echo(dict(["A", ["a", "b"]], ["B", ["c"]]));
	const written = (playlist: number) => ({ status: "written", playlist, unmatched: [] });

	test.each([
		["incomplete", { playlists: [written(0)] }],
		["duplicate", { playlists: [written(0), written(0), written(1)] }],
		["out of range", { playlists: [written(0), written(2)] }],
		[
			"an unmatched song out of range",
			{ playlists: [written(0), { ...written(1), unmatched: [1] }] },
		],
		[
			"a repeated unmatched song",
			{ playlists: [{ ...written(0), unmatched: [0, 0] }, written(1)] },
		],
		["not an output result", { playlists: [{ status: "done", playlist: 0 }] }],
	])("an %s result is a contract error", async (_, returns) => {
		const { status, finished, ofType } = await run({
			inputs: [twoPlaylists],
			modifiers: [],
			outputs: [slot("liar", { returns })],
		});

		expect(status).toBe("failed");
		expect(finished.at(-1)?.error?.code).toBe("contract");
		expect(ofType("result")[0]?.outcome).toMatchObject({ ok: false, error: { code: "contract" } });
	});

	test("a contract error names where in the result the output broke it", async () => {
		const returns = { playlists: [{ ...written(0), unmatched: [0, 0] }, written(1)] };
		const { finished } = await run({
			inputs: [twoPlaylists],
			modifiers: [],
			outputs: [slot("liar", { returns })],
		});

		expect(finished.at(-1)?.error?.message).toContain("result.playlists.0.unmatched.1");
	});

	test("the result event names each playlist and counts the songs the output received", async () => {
		const { ofType } = await run({
			inputs: [twoPlaylists],
			modifiers: [],
			outputs: [slot("refused")],
		});

		const [result] = ofType("result");
		expect(result?.outcome.ok && result.outcome.playlists).toEqual([
			{
				status: "failed",
				playlist: 0,
				playlistName: "A",
				supplied: 2,
				code: "http-500",
				message: "Server error",
			},
			{
				status: "failed",
				playlist: 1,
				playlistName: "B",
				supplied: 1,
				code: "http-500",
				message: "Server error",
			},
		]);
	});

	test("the result event carries copies of the unmatched songs beside their positions", async () => {
		const { ofType } = await run({
			inputs: [twoPlaylists],
			modifiers: [],
			outputs: [slot("writer", { unmatched: [0] })],
		});

		expect(ofType("result")).toEqual([
			expect.objectContaining({
				index: 0,
				plugin: "writer",
				outcome: {
					ok: true,
					playlists: [
						{
							status: "written",
							playlist: 0,
							playlistName: "A",
							supplied: 2,
							unmatched: [0],
							unmatchedSongs: [{ ...song("a"), id: {} }],
						},
						{
							status: "written",
							playlist: 1,
							playlistName: "B",
							supplied: 1,
							unmatched: [0],
							unmatchedSongs: [{ ...song("c"), id: {} }],
						},
					],
				},
			}),
		]);
	});
});

describe("runApplet: service auth", () => {
	const failure: AuthFailure = { service: "plex", code: "reconnect", message: "Grant revoked" };

	test("an AuthFailure fails the stage with its code and the failure, though the plugin wrapped it", async () => {
		const { status, finished } = await run(
			{ inputs: [slot("authed")], modifiers: [], outputs: [slot("writer")] },
			{ capabilities: { auth: fakeAuth({ failure }) } },
		);

		expect(status).toBe("failed");
		expect(finished[0]?.error).toMatchObject({ code: "reconnect", auth: failure });
	});

	test("resolved credentials reach the plugin", async () => {
		const { received } = await run({
			inputs: [slot("authed")],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(received.writer?.[0]?.playlists[0]?.name).toBe("secret");
	});
});

describe("runApplet: the log", () => {
	test("opens with the applet's id and name, the trigger and the plugins in order", async () => {
		const { events } = await run({
			inputs: [echo(dict()), slot("configured")],
			modifiers: [slot("suffix", { suffix: "" })],
			outputs: [slot("writer"), slot("refused")],
		});

		const opening = events.slice(0, 5).map((event) => (event.type === "log" ? event.text : ""));
		const text = opening.join("\n");
		for (const expected of ["applet-1", "Weekly sync", "manual"]) expect(text).toContain(expected);
		expect(text.indexOf("echo")).toBeLessThan(text.indexOf("configured"));
		expect(text.indexOf("configured")).toBeLessThan(text.indexOf("suffix"));
		expect(text.indexOf("suffix")).toBeLessThan(text.indexOf("writer"));
		expect(text.indexOf("writer")).toBeLessThan(text.indexOf("refused"));
	});

	test("numbers every event from 1 and attributes plugin log lines to the plugin", async () => {
		const { events, ofType } = await run({
			inputs: [echo(dict())],
			modifiers: [],
			outputs: [slot("writer")],
		});

		expect(events.map((event) => event.seq)).toEqual(events.map((_, i) => i + 1));
		expect(ofType("log")).toContainEqual(
			expect.objectContaining({ source: "echo", text: "echoing" }),
		);
	});

	test("emits only what the run-event schema describes, with nothing extra", async () => {
		const unprepared = await run({
			inputs: [echo({ playlists: [{ name: "A", songs: [song("a"), { title: "" }] }] })],
			modifiers: [slot("suffix", { suffix: "!" })],
			outputs: [slot("writer", { unmatched: [0] }), slot("thrower"), slot("gone")],
		});
		const ran = await run({
			inputs: [echo({ playlists: [{ name: "A", songs: [song("a"), { title: "" }] }] })],
			modifiers: [slot("suffix", { suffix: "!" })],
			outputs: [slot("writer", { unmatched: [0] }), slot("thrower")],
		});

		for (const event of [...unprepared.events, ...ran.events])
			expect(RunEvent.parse(event)).toEqual(event);
	});

	test.each([
		[1, 0],
		[2, 1],
	])(
		"a songs-mode output given %i playlists warns %i times, and still runs",
		async (count, warnings) => {
			const playlists = Array.from({ length: count }, (_, i): [string, string[]] => [
				`P${i}`,
				["a"],
			]);
			const { status, ofType } = await run({
				inputs: [echo(dict(...playlists))],
				modifiers: [],
				outputs: [slot("songs-only")],
			});

			expect(status).toBe("succeeded");
			expect(ofType("log").filter((line) => line.level === "warn")).toHaveLength(warnings);
		},
	);

	test.each([
		[RUN_DEADLINE_MS, 0],
		[RUN_DEADLINE_MS + 1, 1],
	])("a run ending %i ms after it started warns %i times", async (elapsed, warnings) => {
		let calls = 0;
		// The first reading is the start; every later one is `elapsed` after it.
		const now = () => (calls++ === 0 ? 0 : elapsed);
		const { ofType } = await run(
			{ inputs: [echo(dict())], modifiers: [], outputs: [slot("writer")] },
			{ now },
		);

		expect(ofType("log").filter((line) => line.level === "warn")).toHaveLength(warnings);
	});
});
