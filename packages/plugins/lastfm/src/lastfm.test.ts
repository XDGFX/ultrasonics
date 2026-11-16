import { afterEach, describe, expect, test } from "bun:test";
import {
	createRunContext,
	createTestContext,
	type LogEntry,
	type Plugin,
	RunPayload,
	type SongDictInput,
} from "@ultrasonics/plugin-sdk";
import {
	type FakeLastfm,
	fakeApiKey,
	fakeUser,
	lastfmError,
	manyTracks,
	operationFailed,
	type Route,
	rateLimited,
	startFakeLastfm,
	type TrackLists,
	times,
	unreachableApiBase,
} from "../test/fake-lastfm.ts";
import { createLastfmPlugin } from "./index.ts";
import { songLimit } from "./input-settings.ts";
import {
	LastfmError,
	pacingMs,
	pluginVersion,
	rateLimit,
	reenterKey,
	temporaryFailure,
} from "./lastfm-client.ts";
import { pageSize } from "./listening-history.ts";

let fake: FakeLastfm | undefined;
afterEach(async () => {
	await fake?.stop();
	fake = undefined;
});

function serve(options: { routes?: Route[]; lists?: TrackLists } = {}): FakeLastfm {
	fake = startFakeLastfm(options);
	return fake;
}

/** 16 November 2026, 12:00 UTC: the run's clock. */
const startedAt = Date.UTC(2026, 10, 16, 12);

/** A clock that only `sleep` moves, so pacing and waits are measured, not slept. */
function fakeClock() {
	let time = startedAt;
	const sleeps: number[] = [];
	return {
		sleeps,
		now: () => time,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			time += ms;
		},
	};
}

/** Runs the `inputs` handler through the SDK harness, as the runner would. */
async function readInputs(
	apiBase: string,
	settings: Record<string, unknown>,
	options: { apiKey?: string; clock?: ReturnType<typeof fakeClock> } = {},
): Promise<{ songs: SongDictInput; logs: LogEntry[] }> {
	const clock = options.clock ?? fakeClock();
	const plugin: Plugin = createLastfmPlugin({ apiBase, sleep: clock.sleep, now: clock.now });
	const logs: LogEntry[] = [];
	const payload = RunPayload.parse({
		component: "inputs",
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: "/nonexistent",
		persistent: {},
		instance: plugin.instanceSettings.inputs?.parse({ username: fakeUser, ...settings }),
	});
	const context = createRunContext(
		payload,
		{
			credentials: async () => ({ apiKey: options.apiKey ?? fakeApiKey }),
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: true },
	);
	const songs = await plugin.run.inputs?.(context);
	if (songs === undefined) throw new Error("lastfm has no inputs handler");
	return { songs, logs };
}

/** The error a run fails with, and what it logged first. */
async function failure(
	apiBase: string,
	settings: Record<string, unknown>,
	options: Parameters<typeof readInputs>[2] = {},
): Promise<LastfmError> {
	const error = await readInputs(apiBase, settings, options).then(
		() => undefined,
		(thrown: unknown) => thrown,
	);
	if (!(error instanceof LastfmError)) throw new Error(`expected a LastfmError, got ${error}`);
	return error;
}

const lines = (logs: LogEntry[], level: LogEntry["level"]) =>
	logs.filter((entry) => entry.level === level).map((entry) => entry.message);

describe("reading listening history", () => {
	test("loved tracks: calls user.getLovedTracks and maps each track, with no id", async () => {
		const server = serve();
		const { songs, logs } = await readInputs(server.apiBase, { select: "loved" });

		expect(songs).toEqual({
			playlists: [
				{
					name: "last.fm songs",
					songs: [
						{ title: "The Glass Prison", artists: ["Dream Theater"] },
						{ title: "Respect", artists: ["Aretha Franklin"] },
						{ title: "Hoppípolla", artists: ["Sigur Rós"] },
					],
				},
			],
		});
		const [request] = server.requests;
		expect(Object.fromEntries(request?.query ?? [])).toEqual({
			method: "user.getLovedTracks",
			user: fakeUser,
			api_key: fakeApiKey,
			format: "json",
			limit: String(pageSize),
			page: "1",
		});
		expect(request?.headers.get("user-agent")).toBe(`ultrasonics/${pluginVersion}`);
		expect(lines(logs, "info")).toEqual([
			`Read 3 songs from user.getLovedTracks for ${fakeUser}; dropped 0 repeats`,
		]);
	});

	test("top tracks: asks for the period, and carries a length unless it is 0", async () => {
		const server = serve();
		const { songs } = await readInputs(server.apiBase, {
			select: "top",
			period: "6month",
			name: "best of",
		});

		expect(server.requests[0]?.query.get("method")).toBe("user.getTopTracks");
		expect(server.requests[0]?.query.get("period")).toBe("6month");
		expect(songs.playlists).toEqual([
			{
				name: "best of",
				songs: [
					{ title: "Learning to Live", artists: ["Dream Theater"], durationMs: 690_000 },
					{ title: "Pull Me Under", artists: ["Dream Theater"] },
					{ title: "Hoppípolla", artists: ["Sigur Rós"], durationMs: 268_000 },
				],
			},
		]);
	});

	test("recent tracks: skips now-playing and untitled tracks, and keeps each song once at its latest", async () => {
		const server = serve();
		const { songs, logs } = await readInputs(server.apiBase, { select: "recent" });

		expect(songs.playlists[0]?.songs).toEqual([
			{
				title: "The Glass Prison",
				artists: ["Dream Theater"],
				album: "Six Degrees of Inner Turbulence",
			},
			{ title: "Hoppípolla", artists: ["Sigur Rós"], album: "Takk..." },
			{ title: "Respect", artists: ["Aretha Franklin"] },
		]);
		expect(lines(logs, "warn")).toEqual(["Skipped 1 track without a title"]);
		expect(lines(logs, "info")).toEqual([
			`Read 3 songs from user.getRecentTracks for ${fakeUser}; dropped 1 repeat`,
		]);
	});

	test.each([
		["now", "7d", 0, 7 * 86_400],
		["1m", "1d", 2_629_800, 86_400],
		["2y", "1y", 2 * 31_557_600, 31_557_600],
	])(
		"recent tracks ending %s, spanning %s: asks for that window of the run's clock",
		async (ending, span, endsAgo, lasts) => {
			const server = serve();
			await readInputs(server.apiBase, { select: "recent", ending, span });

			const to = startedAt / 1000 - endsAgo;
			expect(server.requests[0]?.query.get("to")).toBe(String(to));
			expect(server.requests[0]?.query.get("from")).toBe(String(to - lasts));
		},
	);
});

const lovedTracks = (count: number) => manyTracks("loved-tracks.json", "lovedtracks", count);

describe("paging", () => {
	test("stops at the last page when the user has fewer songs than the limit", async () => {
		const server = serve({ lists: { "user.getlovedtracks": await lovedTracks(450) } });
		const { songs } = await readInputs(server.apiBase, {
			select: "loved",
			limit: songLimit.max,
		});

		expect(songs.playlists[0]?.songs).toHaveLength(450);
		expect(server.requests.map((request) => request.query.get("page"))).toEqual(["1", "2", "3"]);
	});

	test("stops once the limit is read", async () => {
		const server = serve({ lists: { "user.getlovedtracks": await lovedTracks(450) } });
		const { songs } = await readInputs(server.apiBase, { select: "loved", limit: pageSize + 1 });

		expect(songs.playlists[0]?.songs).toHaveLength(pageSize + 1);
		expect(server.requests).toHaveLength(2);
	});

	test("a blank limit reads the default", async () => {
		const server = serve({ lists: { "user.getlovedtracks": await lovedTracks(450) } });
		const { songs } = await readInputs(server.apiBase, { select: "loved" });

		expect(songs.playlists[0]?.songs).toHaveLength(songLimit.default);
	});

	test("waits so that no two requests start less than the pacing apart", async () => {
		const clock = fakeClock();
		const startedAtEach: number[] = [];
		const server = serve({
			lists: { "user.getlovedtracks": await lovedTracks(450) },
			routes: [
				() => {
					startedAtEach.push(clock.now());
					return undefined;
				},
			],
		});
		await readInputs(server.apiBase, { select: "loved", limit: songLimit.max }, { clock });

		expect(startedAtEach).toHaveLength(3);
		const gaps = startedAtEach.slice(1).map((at, index) => at - (startedAtEach[index] ?? 0));
		expect(gaps.every((gap) => gap >= pacingMs)).toBe(true);
	});
});

describe("Last.fm's errors", () => {
	test("error 6 fails the run naming the user", async () => {
		const server = serve();
		const error = await failure(server.apiBase, { select: "loved", username: "nobody-here" });

		expect(error.code).toBe("user-not-found");
		expect(error.message).toContain("nobody-here");
	});

	test.each([
		["10", "error-10-invalid-key.json"],
		["26", "error-26-suspended-key.json"],
	])("error %s fails the run as a refused key, asking for it again", async (_, file) => {
		const server = serve({ routes: [() => lastfmError(file, 403)] });
		const error = await failure(server.apiBase, { select: "loved" });
		expect(error.code).toBe("key-refused");
		expect(error.message).toContain(reenterKey);
	});

	test.each([
		["error 29", rateLimited],
		["a bare 429", () => new Response("Too Many Requests", { status: 429 })],
	])("%s is waited out and retried, logging each wait", async (_, response) => {
		const clock = fakeClock();
		const server = serve({ routes: [times(2, "user.getLovedTracks", response)] });
		const { songs, logs } = await readInputs(server.apiBase, { select: "loved" }, { clock });

		expect(songs.playlists[0]?.songs).toHaveLength(3);
		expect(clock.sleeps.filter((ms) => ms === rateLimit.waitMs)).toHaveLength(2);
		expect(lines(logs, "info").filter((line) => line.includes("rate limit"))).toHaveLength(2);
	});

	test("error 29 past the retries for one request fails the run", async () => {
		const clock = fakeClock();
		const server = serve({ routes: [rateLimited] });
		const error = await failure(server.apiBase, { select: "loved" }, { clock });

		expect(error.code).toBe("rate-limited");
		expect(server.requests).toHaveLength(rateLimit.retriesPerRequest + 1);
	});

	test("error 29 past the run's allowance for waiting fails the run", async () => {
		const clock = fakeClock();
		const perRequest = rateLimit.retriesPerRequest;
		let answeredSinceSuccess = 0;
		const server = serve({
			lists: { "user.getlovedtracks": await lovedTracks(songLimit.max) },
			routes: [
				() => {
					if (answeredSinceSuccess === perRequest) {
						answeredSinceSuccess = 0;
						return undefined;
					}
					answeredSinceSuccess += 1;
					return rateLimited();
				},
			],
		});
		const error = await failure(
			server.apiBase,
			{ select: "loved", limit: songLimit.max },
			{ clock },
		);

		expect(error.code).toBe("rate-limited");
		const waited = clock.sleeps.filter((ms) => ms === rateLimit.waitMs);
		expect(waited).toHaveLength(Math.floor(rateLimit.totalWaitMs / rateLimit.waitMs));
	});

	test("a temporary failure is retried once", async () => {
		const clock = fakeClock();
		const server = serve({ routes: [times(1, "user.getLovedTracks", operationFailed)] });
		const { songs } = await readInputs(server.apiBase, { select: "loved" }, { clock });

		expect(songs.playlists[0]?.songs).toHaveLength(3);
		expect(clock.sleeps).toContain(temporaryFailure.waitMs);
	});

	test("a temporary failure twice fails the run", async () => {
		const server = serve({ routes: [operationFailed] });
		expect((await failure(server.apiBase, { select: "loved" })).code).toBe("service-error");
		expect(server.requests).toHaveLength(2);
	});

	test("a body that isn't JSON fails the run", async () => {
		const server = serve({ routes: [() => new Response("<html>oops</html>", { status: 502 })] });
		expect((await failure(server.apiBase, { select: "loved" })).code).toBe("service-error");
	});

	test("no answer at all fails the run as unreachable", async () => {
		const error = await failure(await unreachableApiBase(), { select: "loved" });
		expect(error.code).toBe("unreachable");
	});
});

describe("the key", () => {
	test("appears in no log line or error, whatever happens", async () => {
		const outcomes: string[] = [];
		const record = async (apiBase: string, settings: Record<string, unknown>) => {
			const logs: LogEntry[] = [];
			try {
				const result = await readInputs(apiBase, settings);
				logs.push(...result.logs);
			} catch (error) {
				outcomes.push(String(error), (error as Error).stack ?? "");
			}
			outcomes.push(...logs.map((entry) => entry.message));
		};
		const server = serve({ routes: [times(1, "user.getRecentTracks", rateLimited)] });
		await record(server.apiBase, { select: "recent" });
		await record(server.apiBase, { select: "loved", username: "nobody-here" });
		await record(await unreachableApiBase(), { select: "loved" });

		expect(outcomes.length).toBeGreaterThan(3);
		for (const outcome of outcomes) expect(outcome).not.toContain(fakeApiKey);
	});
});

describe("test()", () => {
	async function check(apiBase: string, apiKey = fakeApiKey) {
		const plugin: Plugin = createLastfmPlugin({ apiBase, sleep: async () => {} });
		const context = createTestContext(
			{ persistent: {}, configDir: "/nonexistent" },
			{ credentials: async () => ({ apiKey }), log: () => {} },
			{ declaresAuth: true },
		);
		return plugin.test?.(context);
	}

	test("ok when Last.fm accepts the key, asking chart.getTopArtists with the key alone", async () => {
		const server = serve();
		expect(await check(server.apiBase)).toEqual({ ok: true });
		const query = server.requests[0]?.query;
		expect(query?.get("method")).toBe("chart.getTopArtists");
		expect(query?.has("user")).toBe(false);
	});

	test("invalid-credentials when Last.fm refuses the key", async () => {
		const server = serve();
		const result = await check(server.apiBase, "f".repeat(32));
		expect(result).toMatchObject({ ok: false, code: "invalid-credentials" });
	});

	test("unreachable when nothing answers", async () => {
		expect(await check(await unreachableApiBase())).toMatchObject({
			ok: false,
			code: "unreachable",
		});
	});

	test("misconfigured, with Last.fm's message, for any other error", async () => {
		const server = serve({
			routes: [() => Response.json({ error: 3, message: "Invalid Method" }, { status: 400 })],
		});
		const result = await check(server.apiBase);
		expect(result).toMatchObject({ ok: false, code: "misconfigured" });
		expect(result?.ok === false && result.message).toContain("Invalid Method");
	});
});
