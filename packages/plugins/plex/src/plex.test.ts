import { afterEach, describe, expect, test } from "bun:test";
import {
	createRunContext,
	createTestContext,
	type LogEntry,
	type OutputResult,
	type Plugin,
	RunPayload,
	type SongDictInput,
	type SongInput,
} from "@ultrasonics/plugin-sdk";
import {
	type FakePlex,
	fakeToken,
	fixture,
	machineIdentifier,
	on,
	type Route,
	startFakePlex,
	unreachableUrl,
} from "../test/fake-plex.ts";
import plex from "./index.ts";
import { batchSize } from "./playlist-output.ts";

/** The plugin as the runner holds it, so its handlers take the contexts the harness builds. */
const plugin: Plugin = plex;

function grant(credentials: Record<string, unknown>): unknown {
	if (plugin.auth === undefined) throw new Error("plex declares no auth");
	return plugin.auth.fields.parse(credentials);
}

let fake: FakePlex | undefined;
afterEach(async () => {
	await fake?.stop();
	fake = undefined;
});

function serve(...routes: Route[]) {
	fake = startFakePlex(routes);
	return fake;
}

interface Run {
	result: OutputResult;
	logs: LogEntry[];
}

async function runOutput(
	server: FakePlex,
	songs: SongDictInput,
	instance: Record<string, unknown> = {},
	credentials: Record<string, unknown> = { serverUrl: server.url, token: fakeToken },
): Promise<Run> {
	const logs: LogEntry[] = [];
	const payload = RunPayload.parse({
		component: "outputs",
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: "/nonexistent",
		persistent: {},
		instance: plex.instanceSettings.outputs.parse(instance),
		songs,
	});
	const context = createRunContext(
		payload,
		{
			credentials: async () => grant(credentials),
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: true },
	);
	const result = await plugin.run.outputs?.(context);
	if (result === undefined) throw new Error("plex has no outputs handler");
	return { result, logs };
}

function playlist(name: string, songs: SongInput[]): SongDictInput {
	return { playlists: [{ name, songs }] };
}

const strobe = { title: "Strobe", artists: ["deadmau5"], durationMs: 637000 };
const midnightCity = { title: "Midnight City", artists: ["M83"] };

/** The rating keys a write request names, from its `server://…/library/metadata/<keys>` URI. */
function keysOf(uri: string | null): string[] {
	const prefix = `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/`;
	expect(uri?.startsWith(prefix)).toBe(true);
	return (uri ?? "").slice(prefix.length).split(",");
}

function writes(server: FakePlex) {
	return server.requests.filter((request) => request.method !== "GET");
}

describe("writing playlists", () => {
	test("creates a missing playlist holding the matched tracks in source order", async () => {
		const server = serve();
		const { result } = await runOutput(server, playlist("New Mix", [midnightCity, strobe]));

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		const [create, ...rest] = writes(server);
		expect(rest).toEqual([]);
		expect(create?.method).toBe("POST");
		expect(create?.path).toBe("/playlists");
		expect(create?.query.get("title")).toBe("New Mix");
		expect(create?.query.get("type")).toBe("audio");
		expect(create?.query.get("smart")).toBe("0");
		expect(keysOf(create?.query.get("uri") ?? null)).toEqual(["1003", "1001"]);
	});

	test("append adds only the matched tracks the playlist doesn't hold, at the end", async () => {
		const server = serve();
		// `Focus` (7001) already holds Strobe (1001) and Windowlicker (1009).
		const { result } = await runOutput(server, playlist("Focus", [strobe, midnightCity]));

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		const [add, ...rest] = writes(server);
		expect(rest).toEqual([]);
		expect(add?.method).toBe("PUT");
		expect(add?.path).toBe("/playlists/7001/items");
		expect(keysOf(add?.query.get("uri") ?? null)).toEqual(["1003"]);
	});

	test("append sends nothing when the playlist already holds every match", async () => {
		const server = serve();
		const { result } = await runOutput(server, playlist("Focus", [strobe]));

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		expect(writes(server)).toEqual([]);
	});

	test("update adds every match in source order, then removes the previous items", async () => {
		const server = serve();
		const { result } = await runOutput(server, playlist("Focus", [midnightCity, strobe]), {
			existing: "update",
		});

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		const sent = writes(server);
		expect(sent.map((request) => `${request.method} ${request.path}`)).toEqual([
			"PUT /playlists/7001/items",
			"DELETE /playlists/7001/items/9001",
			"DELETE /playlists/7001/items/9002",
		]);
		expect(keysOf(sent[0]?.query.get("uri") ?? null)).toEqual(["1003", "1001"]);
	});

	test("update that fails to add removes nothing, so the old playlist survives", async () => {
		const server = serve(
			on("PUT", "/playlists/7001/items", () => new Response(null, { status: 500 })),
		);
		const { result } = await runOutput(server, playlist("Focus", [midnightCity]), {
			existing: "update",
		});

		expect(result.playlists[0]).toMatchObject({ status: "failed", code: "service-error" });
		expect(writes(server).filter((request) => request.method === "DELETE")).toEqual([]);
	});

	test("ignores smart and video playlists that share the title", async () => {
		const server = serve();
		// `Running` exists only as a smart audio playlist and a video playlist.
		const { result } = await runOutput(server, playlist("Running", [strobe]));

		expect(result.playlists[0]?.status).toBe("written");
		expect(writes(server).map((request) => `${request.method} ${request.path}`)).toEqual([
			"POST /playlists",
		]);
	});

	test("skips a title two ordinary audio playlists share", async () => {
		const server = serve();
		const { result, logs } = await runOutput(server, playlist("Twice", [strobe]));

		expect(result.playlists[0]).toMatchObject({ status: "skipped", code: "ambiguous-playlist" });
		expect(writes(server)).toEqual([]);
		expect(logs.some((entry) => entry.level === "warn")).toBe(true);
	});

	test("writes a playlist longer than one batch in several requests, in order", async () => {
		const keys = Array.from({ length: batchSize + 3 }, (_, index) => String(2000 + index));
		const strobeTrack = await trackFixture("1001");
		const server = serve((request) => {
			const key = /^\/library\/metadata\/(2\d{3})$/.exec(request.path)?.[1];
			return key === undefined
				? undefined
				: Response.json({
						MediaContainer: { size: 1, Metadata: [{ ...strobeTrack, ratingKey: key }] },
					});
		});
		const songs = keys.map((key) => ({ ...strobe, id: { [`plex:${machineIdentifier}`]: key } }));
		const { result } = await runOutput(server, playlist("Long", songs));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		const sent = writes(server);
		expect(sent.map((request) => request.method)).toEqual(["POST", "PUT"]);
		expect(sent.flatMap((request) => keysOf(request.query.get("uri")))).toEqual(keys);
	});
});

describe("results", () => {
	test("skips an empty playlist", async () => {
		const server = serve();
		const { result } = await runOutput(server, playlist("Nothing yet", []));

		expect(result.playlists[0]).toMatchObject({ status: "skipped", code: "empty" });
		expect(writes(server)).toEqual([]);
	});

	test("skips a playlist where nothing matched, without asking Plex to create it", async () => {
		const server = serve();
		const { result, logs } = await runOutput(
			server,
			playlist("Strangers", [{ title: "Not In This Library", artists: ["Nobody"] }]),
		);

		expect(result.playlists[0]).toMatchObject({ status: "skipped", code: "no-matches" });
		expect(writes(server)).toEqual([]);
		expect(logs.some((entry) => entry.level === "warn")).toBe(true);
	});

	test("a refused write fails that playlist only, and the next is still written", async () => {
		const server = serve((request) =>
			request.method === "POST" && request.query.get("title") === "First"
				? new Response("Internal Server Error", { status: 500 })
				: undefined,
		);
		const songs = {
			playlists: [
				{ name: "First", songs: [strobe] },
				{ name: "Second", songs: [strobe] },
			],
		};
		const { result } = await runOutput(server, songs);

		expect(result.playlists).toEqual([
			{
				status: "failed",
				playlist: 0,
				code: "service-error",
				message: expect.stringContaining("500"),
			},
			{ status: "written", playlist: 1, unmatched: [] },
		]);
	});

	test("lists unmatched songs by position", async () => {
		const server = serve();
		const nobody = { title: "Not In This Library", artists: ["Nobody"] };
		const { result } = await runOutput(server, playlist("Mixed", [nobody, strobe, nobody]));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [0, 2] });
	});
});

describe("matching", () => {
	function searchedTitles(server: FakePlex): (string | null)[] {
		return server.requests
			.filter((request) => request.path.endsWith("/all"))
			.map((request) => request.query.get("title"));
	}

	test("a song whose search Plex rejects is unmatched, and the rest are written", async () => {
		const server = serve((request) =>
			request.query.get("title") === "Midnight City"
				? new Response("Bad Request", { status: 400 })
				: undefined,
		);
		const { result } = await runOutput(server, playlist("Mix", [midnightCity, strobe]));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [0] });
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual(["1001"]);
	});

	test("a song in this server's ID space is written straight to its track", async () => {
		const server = serve();
		const song = {
			title: "Renamed Elsewhere",
			artists: [],
			id: { [`plex:${machineIdentifier}`]: "1003" },
		};
		const { result } = await runOutput(server, playlist("Mix", [song]));

		expect(result.playlists[0]?.status).toBe("written");
		expect(searchedTitles(server)).toEqual([]);
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual(["1003"]);
	});

	const album = { ratingKey: "1101", type: "album", title: "Strobe", librarySectionID: 1 };
	const ownIdCases: [string, string, Route[]][] = [
		["names nothing on the server", "999999", []],
		[
			"names an album, not a track",
			"1101",
			[
				on("GET", "/library/metadata/1101", () =>
					Response.json({ MediaContainer: { size: 1, Metadata: [album] } }),
				),
			],
		],
		[
			"can't be looked up",
			"1001",
			[on("GET", "/library/metadata/1001", () => new Response(null, { status: 500 }))],
		],
	];
	for (const [name, ratingKey, routes] of ownIdCases) {
		test(`a song whose own ID ${name} falls through to search`, async () => {
			const server = serve(...routes);
			const song = { ...strobe, id: { [`plex:${machineIdentifier}`]: ratingKey } };
			const { result } = await runOutput(server, playlist("Mix", [song]));

			expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
			expect(searchedTitles(server)).toEqual(["Strobe"]);
			expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual(["1001"]);
		});
	}

	test("a bracketed title is searched again cut before the bracket", async () => {
		const server = serve();
		const song = { ...strobe, title: "Strobe (2009 Remaster)" };
		const { result } = await runOutput(server, playlist("Mix", [song]));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		expect(searchedTitles(server)).toEqual(["Strobe (2009 Remaster)", "Strobe"]);
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual(["1001"]);
	});

	test("a song with only a title and a file location can match (#49)", async () => {
		const server = serve();
		const song = {
			title: "Teardrop",
			artists: [],
			location: "file:///music/Massive%20Attack/Mezzanine/03%20Teardrop.flac",
		};
		const { result } = await runOutput(server, playlist("From m3u", [song]));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual(["1010"]);
	});

	test("curly quotes, colons and non-ASCII names reach Plex intact", async () => {
		const server = serve();
		const songs = [
			{ title: "“Heroes”", artists: ["David Bowie"] },
			{ title: "Let’s Dance", artists: ["David Bowie"] },
			{ title: "Requiem: Lacrimosa", artists: ["Wolfgang Amadeus Mozart"] },
		];
		const { result } = await runOutput(server, playlist("Bowie & Mozart — ünïcödé", songs));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		expect(searchedTitles(server)).toEqual(["“Heroes”", "Let’s Dance", "Requiem: Lacrimosa"]);
		const [create] = writes(server);
		expect(create?.query.get("title")).toBe("Bowie & Mozart — ünïcödé");
		expect(keysOf(create?.query.get("uri") ?? null)).toEqual(["1005", "1006", "1007"]);
	});
});

const twoMusic = await fixture("library-sections-two-music.json");

describe("libraries", () => {
	const sections = (body: unknown) => on("GET", "/library/sections", () => Response.json(body));

	function searchedSections(server: FakePlex): string[] {
		return server.requests
			.filter((request) => request.path.endsWith("/all"))
			.map((request) => request.path);
	}

	test("blank uses the only music library, ignoring the rest", async () => {
		const server = serve();
		await runOutput(server, playlist("Mix", [strobe]));

		expect(searchedSections(server)).toEqual(["/library/sections/1/all"]);
	});

	test("a title matches without regard to case", async () => {
		const server = serve(sections(twoMusic));
		await runOutput(server, playlist("Mix", [strobe]), { library: "audioBOOKS" });

		expect(searchedSections(server)).toEqual(["/library/sections/3/all"]);
	});

	test("a bare section id names its library", async () => {
		const server = serve(sections(twoMusic));
		await runOutput(server, playlist("Mix", [strobe]), { library: "3" });

		expect(searchedSections(server)).toEqual(["/library/sections/3/all"]);
	});

	const unresolvable: [string, unknown, string | undefined][] = [
		["blank with several music libraries", twoMusic, undefined],
		["an unknown title", twoMusic, "Podcasts"],
		["a library that isn't music", twoMusic, "Films"],
		["the section id of a library that isn't music", twoMusic, "2"],
	];
	for (const [name, body, library] of unresolvable) {
		test(`${name} throws misconfigured, listing the music libraries`, async () => {
			const server = serve(sections(body));
			const run = runOutput(server, playlist("Mix", [strobe]), { library });

			const error = await run.catch((thrown: unknown) => thrown);
			expect(error).toMatchObject({ code: "misconfigured" });
			expect(String((error as Error).message)).toContain('"Music", "Audiobooks"');
			expect(searchedSections(server)).toEqual([]);
			expect(writes(server)).toEqual([]);
		});
	}

	test("two music libraries sharing the title throw misconfigured", async () => {
		const duplicated = structuredClone(twoMusic) as {
			MediaContainer: { Directory: { title: string }[] };
		};
		for (const directory of duplicated.MediaContainer.Directory) {
			if (directory.title === "Audiobooks") directory.title = "Music";
		}
		const server = serve(sections(duplicated));

		const error = await runOutput(server, playlist("Mix", [strobe]), { library: "music" }).catch(
			(thrown: unknown) => thrown,
		);
		expect(error).toMatchObject({ code: "misconfigured" });
		expect(searchedSections(server)).toEqual([]);
	});
});

describe("failures", () => {
	test("an unreachable server throws before any playlist is touched", async () => {
		const url = await unreachableUrl();
		const server = serve();
		const error = await runOutput(
			server,
			playlist("Mix", [strobe]),
			{},
			{
				serverUrl: url,
				token: fakeToken,
			},
		).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ code: "unreachable" });
	});

	test("a refused token throws before any playlist request, asking for it again", async () => {
		const server = serve();
		const error = await runOutput(
			server,
			playlist("Mix", [strobe]),
			{},
			{
				serverUrl: server.url,
				token: "revoked-token",
			},
		).catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({ code: "invalid-credentials" });
		expect(server.requests.map((request) => request.path)).toEqual(["/"]);
	});

	test("a token refused partway throws rather than failing one playlist", async () => {
		const server = serve(on("POST", "/playlists", () => new Response(null, { status: 401 })));
		const error = await runOutput(server, playlist("Mix", [strobe])).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toMatchObject({ code: "invalid-credentials" });
	});

	test("the token travels only in its header, never in a URL, log line or message", async () => {
		const server = serve(
			on("POST", "/playlists", () => new Response(null, { status: 500 })),
			(request) =>
				request.query.get("title") === "Midnight City"
					? new Response(null, { status: 400 })
					: undefined,
		);
		// A server URL pasted with the token in its query must not carry it onward.
		const serverUrl = `${server.url}?X-Plex-Token=${fakeToken}`;
		const { result, logs } = await runOutput(
			server,
			playlist("Mix", [strobe, midnightCity]),
			{},
			{ serverUrl, token: fakeToken },
		);
		const refused = await runOutput(
			server,
			playlist("Mix", [strobe]),
			{},
			{
				serverUrl,
				token: "revoked-token",
			},
		).catch((thrown: unknown) => thrown);
		const unreachable = await runOutput(
			server,
			playlist("Mix", [strobe]),
			{},
			{
				serverUrl: `${await unreachableUrl()}?X-Plex-Token=${fakeToken}`,
				token: fakeToken,
			},
		).catch((thrown: unknown) => thrown);

		expect(server.requests.every((request) => request.headers.has("X-Plex-Token"))).toBe(true);
		const seen = [
			...server.requests.map((request) => request.url),
			...logs.map((entry) => entry.message),
			JSON.stringify(result),
			(refused as Error).message,
			(unreachable as Error).message,
		];
		expect(seen.filter((text) => text.includes(fakeToken))).toEqual([]);
	});
});

describe("test()", () => {
	async function check(credentials: Record<string, unknown>) {
		const context = createTestContext(
			{ persistent: {}, configDir: "/nonexistent" },
			{ credentials: async () => grant(credentials), log: () => {} },
			{ declaresAuth: true },
		);
		return plugin.test?.(context);
	}

	test("ok when the server accepts the token", async () => {
		const server = serve();
		expect(await check({ serverUrl: server.url, token: fakeToken })).toEqual({ ok: true });
	});

	test("invalid-credentials when Plex refuses the token", async () => {
		const server = serve();
		expect(await check({ serverUrl: server.url, token: "revoked-token" })).toMatchObject({
			ok: false,
			code: "invalid-credentials",
		});
	});

	test("invalid-credentials when Plex forbids the token", async () => {
		const server = serve(on("GET", "/", () => new Response(null, { status: 403 })));
		expect(await check({ serverUrl: server.url, token: fakeToken })).toMatchObject({
			ok: false,
			code: "invalid-credentials",
		});
	});

	test("unreachable when nothing answers", async () => {
		expect(await check({ serverUrl: await unreachableUrl(), token: fakeToken })).toMatchObject({
			ok: false,
			code: "unreachable",
		});
	});

	test("misconfigured, with the status, when the server answers with an error", async () => {
		const server = serve(on("GET", "/", () => new Response(null, { status: 404 })));
		expect(await check({ serverUrl: server.url, token: fakeToken })).toMatchObject({
			ok: false,
			code: "misconfigured",
			message: expect.stringContaining("404"),
		});
	});
});

async function trackFixture(key: string): Promise<Record<string, unknown>> {
	const body = (await fixture("library-section-tracks.json")) as {
		MediaContainer: { Metadata: { ratingKey: string }[] };
	};
	const track = body.MediaContainer.Metadata.find((candidate) => candidate.ratingKey === key);
	if (track === undefined) throw new Error(`No track ${key} in the fixture`);
	return track;
}
