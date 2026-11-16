import { afterEach, describe, expect, test } from "bun:test";
import {
	createRunContext,
	createTestContext,
	type LogEntry,
	type Plugin,
	RunPayload,
	type SongDictInput,
	StrictSongDict,
} from "@ultrasonics/plugin-sdk";
import {
	type FakeSpotify,
	fakeToken,
	on,
	playlistIds,
	type Route,
	rateLimited,
	startFakeSpotify,
	times,
	unreachableApiBase,
} from "../test/fake-spotify.ts";
import { createSpotifyPlugin } from "./index.ts";
import { rateLimit } from "./spotify-client.ts";

let fake: FakeSpotify | undefined;
afterEach(async () => {
	await fake?.stop();
	fake = undefined;
});

function serve(...routes: Route[]): FakeSpotify {
	fake = startFakeSpotify(routes);
	return fake;
}

interface Read {
	songs: SongDictInput;
	logs: LogEntry[];
	/** How many times the handler asked for credentials. */
	credentialCalls: number;
}

/** Runs the `inputs` handler through the SDK harness, as the runner would. */
async function readInputs(
	server: FakeSpotify,
	instance: Record<string, unknown>,
	options: { sleep?: (ms: number) => Promise<void>; token?: string } = {},
): Promise<Read> {
	const plugin: Plugin = createSpotifyPlugin({
		apiBase: server.apiBase,
		...(options.sleep ? { sleep: options.sleep } : {}),
	});
	const logs: LogEntry[] = [];
	let credentialCalls = 0;
	const payload = RunPayload.parse({
		component: "inputs",
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: "/nonexistent",
		persistent: {},
		instance: plugin.instanceSettings.inputs?.parse(instance),
	});
	const context = createRunContext(
		payload,
		{
			credentials: async () => {
				credentialCalls += 1;
				return { accessToken: options.token ?? fakeToken };
			},
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: true },
	);
	const songs = await plugin.run.inputs?.(context);
	if (songs === undefined) throw new Error("spotify has no inputs handler");
	return { songs, logs, credentialCalls };
}

const lines = (logs: LogEntry[], level: LogEntry["level"]) =>
	logs.filter((entry) => entry.level === level).map((entry) => entry.message);

describe("reading chosen playlists", () => {
	test("maps a playlist and its tracks into the song dict, skipping odd items", async () => {
		const server = serve();
		const { songs, logs } = await readInputs(server, {
			source: "chosen",
			playlists: `https://open.spotify.com/playlist/${playlistIds.focus}?si=abc123`,
		});

		expect(StrictSongDict.safeParse(songs).success).toBe(true);
		expect(songs.playlists).toEqual([
			{
				name: "Focus",
				description: "Cal's deep work & nothing else",
				id: { spotify: playlistIds.focus },
				songs: [
					{
						title: "Strobe",
						artists: ["deadmau5"],
						album: "For Lack of a Better Name",
						date: "2009-09-22",
						isrc: "USUS10900123",
						durationMs: 637000,
						explicit: false,
						id: { spotify: "2CY92qejUrhyPUASawNVRr" },
					},
					{ title: "Demo take 3", artists: ["Cal"], explicit: false },
					{
						title: "Field recording",
						artists: [],
						album: "Ambient sketches",
						date: "1998-03",
						isrc: "GBAAA9800001",
						durationMs: 95000,
						explicit: true,
						id: { spotify: "6habFhsOp2NvshLv26DqMb" },
					},
				],
			},
		]);
		const warnings = lines(logs, "warn");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('"Focus"');
		expect(lines(logs, "info").filter((line) => line.includes('"Focus"'))).toHaveLength(1);
	});
});

test("asks for credentials before each request, never logging the token", async () => {
	const server = serve();
	const { credentialCalls, logs } = await readInputs(server, {
		source: "chosen",
		playlists: playlistIds.roadTrip,
	});
	expect(credentialCalls).toBe(server.requests.length);
	for (const request of server.requests) expect(request.url).not.toContain(fakeToken);
	for (const entry of logs) expect(entry.message).not.toContain(fakeToken);
});

describe("choosing playlists", () => {
	test("takes links, URIs and bare ids, in the order given, reading a duplicate once", async () => {
		const server = serve();
		const { songs } = await readInputs(server, {
			source: "chosen",
			playlists: [
				`spotify:playlist:${playlistIds.roadTrip}`,
				`https://open.spotify.com/intl-de/playlist/${playlistIds.focus}`,
				playlistIds.roadTrip,
			].join(", "),
		});
		expect(songs.playlists.map((playlist) => playlist.name)).toEqual(["Road trip", "Focus"]);
		const detailReads = server.requests.filter((r) => /^\/playlists\/\w+$/.test(r.path));
		expect(detailReads.map((r) => r.path)).toEqual([
			`/playlists/${playlistIds.roadTrip}`,
			`/playlists/${playlistIds.focus}`,
		]);
	});

	test("skips a playlist it can't read with a warning naming it, and reads the rest", async () => {
		const server = serve();
		const { songs, logs } = await readInputs(server, {
			source: "chosen",
			playlists: [playlistIds.forbidden, playlistIds.missing, playlistIds.roadTrip].join(","),
		});
		expect(songs.playlists.map((playlist) => playlist.name)).toEqual(["Road trip"]);
		const warnings = lines(logs, "warn");
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain(playlistIds.forbidden);
		expect(warnings[0]).toContain("403");
		expect(warnings[1]).toContain(playlistIds.missing);
		expect(warnings[1]).toContain("404");
	});

	test("reads every page of a playlist in order, by next", async () => {
		const server = serve();
		const { songs } = await readInputs(server, {
			source: "chosen",
			playlists: playlistIds.roadTrip,
		});
		expect(songs.playlists[0]?.songs.map((song) => song.title)).toEqual([
			"One",
			"Two",
			"Three",
			"Four",
			"Five",
		]);
		const itemPages = server.requests.filter((r) => r.path.endsWith("/items"));
		expect(itemPages.map((r) => r.query.get("offset"))).toEqual([null, "2", "4"]);
		expect(itemPages[0]?.query.get("fields")).toContain("is_local");
	});
});

describe("all my playlists", () => {
	test("keeps owned and collaborative playlists, and counts the followed ones it left out", async () => {
		const server = serve();
		const { songs, logs } = await readInputs(server, { source: "all" });
		expect(songs.playlists.map((playlist) => playlist.name)).toEqual([
			"Focus",
			"Shared mix",
			"Gym",
		]);
		// The fixtures hold two playlists the user only follows.
		expect(lines(logs, "info").filter((line) => /\b2\b/.test(line))).toHaveLength(1);
		expect(server.requests.some((r) => r.path.includes(playlistIds.forbidden))).toBe(false);
	});

	test("leaves out the playlists named in exclude, whatever their case", async () => {
		const server = serve();
		const { songs } = await readInputs(server, { source: "all", exclude: "gym,  FOCUS " });
		expect(songs.playlists.map((playlist) => playlist.name)).toEqual(["Shared mix"]);
	});
});

test("liked songs come as one playlist with the chosen name, newest first", async () => {
	const server = serve();
	const { songs } = await readInputs(server, { source: "liked", name: "loved" });
	expect(songs.playlists).toHaveLength(1);
	expect(songs.playlists[0]?.name).toBe("loved");
	expect(songs.playlists[0]?.id).toBeUndefined();
	expect(songs.playlists[0]?.songs.map((song) => song.title)).toEqual(["Three", "One", "Two"]);
});

describe("errors", () => {
	const chosen = { source: "chosen", playlists: playlistIds.roadTrip };

	test("a refused token throws", async () => {
		const server = serve();
		await expect(readInputs(server, chosen, { token: "stale" })).rejects.toMatchObject({
			code: "invalid-credentials",
			status: 401,
		});
	});

	test("a 5xx throws", async () => {
		const server = serve(on("/me/playlists", () => new Response("boom", { status: 502 })));
		await expect(readInputs(server, { source: "all" })).rejects.toMatchObject({
			code: "service-error",
			status: 502,
		});
	});

	test("a 429 is waited out and the request retried, with an info line", async () => {
		const waits: number[] = [];
		const server = serve(times(2, /\/items$/, () => rateLimited(7)));
		const { songs, logs } = await readInputs(server, chosen, {
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		expect(songs.playlists[0]?.songs).toHaveLength(5);
		expect(waits).toEqual([7000, 7000]);
		expect(lines(logs, "info").filter((line) => line.includes("/items"))).toHaveLength(2);
	});

	test("a 429 past the retries allowed for one request throws", async () => {
		const server = serve(times(rateLimit.retriesPerRequest + 1, /\/items$/, () => rateLimited(1)));
		await expect(readInputs(server, chosen, { sleep: async () => {} })).rejects.toMatchObject({
			code: "rate-limited",
		});
	});

	test("waits over a run add up, and one that would pass the run's allowance throws unwaited", async () => {
		const allowanceSeconds = rateLimit.totalWaitMs / 1000;
		const first = allowanceSeconds - 20;
		const waits: number[] = [];
		const server = serve(
			times(1, /^\/me$/, () => rateLimited(first)),
			times(1, "/me/playlists", () => rateLimited(30)),
		);
		const outcome = readInputs(
			server,
			{ source: "all" },
			{ sleep: async (ms) => void waits.push(ms) },
		);
		await expect(outcome).rejects.toMatchObject({ code: "rate-limited" });
		expect(waits).toEqual([first * 1000]);
	});
});

describe("test()", () => {
	async function testWith(apiBase: string, token = fakeToken) {
		const plugin: Plugin = createSpotifyPlugin({ apiBase });
		const context = createTestContext(
			{ persistent: {}, configDir: "/nonexistent" },
			{ credentials: async () => ({ accessToken: token }), log: () => {} },
			{ declaresAuth: true },
		);
		return plugin.test?.(context);
	}

	test("answers ok when Spotify knows the token", async () => {
		expect(await testWith(serve().apiBase)).toEqual({ ok: true });
	});

	test("answers invalid-credentials on a 401", async () => {
		expect(await testWith(serve().apiBase, "stale")).toMatchObject({
			ok: false,
			code: "invalid-credentials",
		});
	});

	test("answers misconfigured on a 403, pointing at the user list", async () => {
		const server = serve(on("/me", () => Response.json({}, { status: 403 })));
		expect(await testWith(server.apiBase)).toEqual({
			ok: false,
			code: "misconfigured",
			message:
				"This Spotify account isn't on your app's user list. Development mode allows five users, added under User Management.",
		});
	});

	test("answers unreachable when nothing answers", async () => {
		expect(await testWith(await unreachableApiBase())).toMatchObject({
			ok: false,
			code: "unreachable",
		});
	});

	test("answers misconfigured with the status otherwise", async () => {
		const server = serve(on("/me", () => new Response("", { status: 500 })));
		const result = await testWith(server.apiBase);
		expect(result).toMatchObject({ ok: false, code: "misconfigured" });
		expect(result?.ok === false && result.message).toContain("500");
	});
});
