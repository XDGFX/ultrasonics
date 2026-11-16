import { afterEach, describe, expect, test } from "bun:test";
import {
	createRunContext,
	type LogEntry,
	type Plugin,
	RunPayload,
	type SongDictInput,
} from "@ultrasonics/plugin-sdk";
import {
	existingPlaylistKey,
	type FakePlex,
	fakeToken,
	fixture,
	machineIdentifier,
	notFound,
	type Route,
	smartPlaylistKey,
	startFakePlex,
	unreachableUrl,
} from "../test/fake-plex.ts";
import plex from "./index.ts";
import { itemsPageSize } from "./plex-client.ts";

/** The plugin as the runner holds it, so its handlers take the contexts the harness builds. */
const plugin: Plugin = plex;

let fake: FakePlex | undefined;
afterEach(async () => {
	await fake?.stop();
	fake = undefined;
});

function serve(...routes: Route[]): FakePlex {
	fake = startFakePlex(routes);
	return fake;
}

interface Read {
	songs: SongDictInput;
	logs: LogEntry[];
}

/** Runs the `inputs` handler through the SDK harness, as the runner would. */
async function readInputs(
	server: FakePlex,
	instance: Record<string, unknown>,
	credentials: Record<string, unknown> = { serverUrl: server.url, token: fakeToken },
): Promise<Read> {
	const logs: LogEntry[] = [];
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
			credentials: async () => plugin.auth?.fields.parse(credentials),
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: true },
	);
	const songs = await plugin.run.inputs?.(context);
	if (songs === undefined) throw new Error("plex has no inputs handler");
	return { songs, logs };
}

const idSpace = `plex:${machineIdentifier}`;
const title = "ultrasonics Plex test";

describe("reading playlists", () => {
	test("all reads every audio playlist, smart ones included, with its name and this server's id", async () => {
		const server = serve();

		const { songs } = await readInputs(server, { source: "all" });

		// `playlists.json` in server order, less the video playlist 51.
		expect(songs.playlists.map((playlist) => [playlist.name, playlist.id])).toEqual([
			["Smart only", { [idSpace]: "50" }],
			[title, { [idSpace]: smartPlaylistKey }],
			["Twice", { [idSpace]: "48" }],
			["Twice", { [idSpace]: "49" }],
			[title, { [idSpace]: existingPlaylistKey }],
		]);
		expect(songs.playlists[4]?.songs.map((song) => song.title)).toEqual([
			"Carefree",
			"Hitman",
			"Sneaky Snitch",
		]);
		expect(songs.playlists[4]?.songs[0]).toEqual({
			title: "Carefree",
			artists: ["Kevin MacLeod"],
			album: "Calming",
			durationMs: 205140,
			date: "2014",
			location: expect.stringMatching(/^file:\/\/\/.*Carefree/),
			id: { [idSpace]: "23" },
		});
		expect(songs.playlists[1]?.songs.map((song) => song.title)).toEqual([
			"Local Forecast",
			"Local Forecast - Elevator",
		]);
	});
});

const warnings = (logs: LogEntry[]) =>
	logs.filter((entry) => entry.level === "warn").map((entry) => entry.message);

/** The playlists whose items were requested, in order, once each. */
const itemsRead = (server: FakePlex) => [
	...new Set(
		server.requests.flatMap(
			(request) => /^\/playlists\/(\d+)\/items$/.exec(request.path)?.[1] ?? [],
		),
	),
];

/** `playlists.json` with some playlists' fields replaced, by rating key. */
function listingWith(changes: Record<string, Record<string, unknown>>): Route {
	return async (request) => {
		if (request.method !== "GET" || request.path !== "/playlists") return undefined;
		const body = (await fixture("playlists.json")) as {
			MediaContainer: { Metadata: { ratingKey: string; playlistType: string }[] };
		};
		const metadata = body.MediaContainer.Metadata.filter(
			(playlist) => playlist.playlistType === "audio",
		).map((playlist) => ({ ...playlist, ...changes[playlist.ratingKey] }));
		return Response.json({ MediaContainer: { size: metadata.length, Metadata: metadata } });
	};
}

/** Answers `GET /playlists/<key>/items` with `answer`, given the request's start. */
function items(key: string, answer: (start: number) => Response | Promise<Response>): Route {
	return (request) =>
		request.method === "GET" && request.path === `/playlists/${key}/items`
			? answer(Number(request.query.get("X-Plex-Container-Start") ?? 0))
			: undefined;
}

describe("choosing playlists", () => {
	test("all leaves out the playlists exclude names, ignoring case", async () => {
		const server = serve();

		const { songs } = await readInputs(server, { source: "all", exclude: "twice, SMART*" });

		expect(songs.playlists.map((playlist) => playlist.id)).toEqual([
			{ [idSpace]: smartPlaylistKey },
			{ [idSpace]: existingPlaylistKey },
		]);
	});

	test("chosen reads each pattern's matches in the order the patterns are given", async () => {
		const server = serve();

		const { songs } = await readInputs(server, { source: "chosen", playlists: "smart*, tw?ce" });

		expect(songs.playlists.map((playlist) => playlist.id?.[idSpace])).toEqual(["50", "48", "49"]);
	});

	test("chosen reads a playlist two patterns match once, at its first", async () => {
		const server = serve();

		const { songs } = await readInputs(server, {
			source: "chosen",
			playlists: "Smart only, *only, S*",
		});

		expect(songs.playlists.map((playlist) => playlist.id?.[idSpace])).toEqual(["50"]);
		expect(itemsRead(server)).toEqual(["50"]);
	});

	test("chosen warns of a pattern that matches nothing, and reads the rest", async () => {
		const server = serve();

		const { songs, logs } = await readInputs(server, {
			source: "chosen",
			playlists: "Gym*, Smart only",
		});

		expect(songs.playlists.map((playlist) => playlist.name)).toEqual(["Smart only"]);
		expect(warnings(logs)).toEqual([expect.stringContaining('"Gym*"')]);
	});

	test("chosen reads both playlists that share a plain title, with a warning", async () => {
		const server = serve();

		const { songs, logs } = await readInputs(server, {
			source: "chosen",
			playlists: "ULTRASONICS plex TEST",
		});

		expect(songs.playlists.map((playlist) => playlist.id?.[idSpace])).toEqual([
			smartPlaylistKey,
			existingPlaylistKey,
		]);
		expect(warnings(logs)).toEqual([expect.stringContaining('"ULTRASONICS plex TEST"')]);
	});

	test("a pattern with a wildcard matching several playlists reads them without a warning", async () => {
		const server = serve();

		const { songs, logs } = await readInputs(server, { source: "chosen", playlists: "Twic*" });

		expect(songs.playlists).toHaveLength(2);
		expect(warnings(logs)).toEqual([]);
	});

	test("no items are requested for a playlist the settings drop (#15)", async () => {
		const server = serve();

		await readInputs(server, { source: "chosen", playlists: "Twice" });
		await readInputs(server, { source: "all", exclude: "ultrasonics*, smart only" });

		expect(itemsRead(server)).toEqual(["48", "49"]);
		expect(server.requests.filter((request) => request.path === "/playlists")).toSatisfy(
			(listings) => listings.every((request) => request.query.get("playlistType") === "audio"),
		);
	});
});

describe("reading a playlist", () => {
	test("a playlist Plex answers in two pages is read in full and in order, stopping at totalSize", async () => {
		const pages: Record<number, string> = {
			0: "playlist-items-page-1.json",
			2: "playlist-items-page-2.json",
		};
		const server = serve(
			items(existingPlaylistKey, async (start) => {
				const page = pages[start];
				if (page === undefined) throw new Error(`read past totalSize, from ${start}`);
				return Response.json(await fixture(page));
			}),
		);

		const { songs } = await readInputs(server, { source: "chosen", playlists: "ultrasonics*" });

		expect(songs.playlists[1]?.songs.map((song) => song.id?.[idSpace])).toEqual(["23", "9", "25"]);
		const starts = server.requests
			.filter((request) => request.path === `/playlists/${existingPlaylistKey}/items`)
			.map((request) => request.query.get("X-Plex-Container-Start"));
		expect(starts).toEqual(["0", "2"]);
	});

	test("without totalSize, a playlist is read until a page comes back empty", async () => {
		const recorded = (await fixture("playlist-items.json")) as {
			MediaContainer: { Metadata: unknown[] };
		};
		const all = recorded.MediaContainer.Metadata;
		const server = serve(
			items(existingPlaylistKey, (start) => {
				const page = all.slice(start, start + 2);
				return Response.json({ MediaContainer: { size: page.length, Metadata: page } });
			}),
		);

		const { songs } = await readInputs(server, { source: "all", exclude: "smart*, twice" });

		expect(songs.playlists[1]?.songs.map((song) => song.title)).toEqual([
			"Carefree",
			"Hitman",
			"Sneaky Snitch",
		]);
	});

	test("items are asked for a page of itemsPageSize at a time, without Plex's Guids", async () => {
		const server = serve();

		await readInputs(server, { source: "chosen", playlists: "Smart only" });

		const [request] = server.requests.filter((r) => r.path === "/playlists/50/items");
		expect(request?.query.get("X-Plex-Container-Size")).toBe(String(itemsPageSize));
		expect(request?.query.has("includeGuids")).toBe(false);
	});

	test("a playlist carries its summary as description, and none when the summary is blank", async () => {
		const server = serve(
			listingWith({
				[existingPlaylistKey]: { summary: "  Songs for the road  " },
				[smartPlaylistKey]: { summary: "   " },
			}),
		);

		const { songs } = await readInputs(server, { source: "chosen", playlists: title });

		expect(songs.playlists.map((playlist) => playlist.description)).toEqual([
			undefined,
			"Songs for the road",
		]);
		expect(songs.playlists[0]).not.toHaveProperty("description");
		expect(songs.playlists[0]).not.toHaveProperty("title");
	});

	test("an untitled item and a non-track item are skipped with one warning, and the rest read", async () => {
		const recorded = (await fixture("playlist-items.json")) as {
			MediaContainer: { Metadata: Record<string, unknown>[] };
		};
		const [first, second, third] = recorded.MediaContainer.Metadata;
		const odd = [{ ...first, title: undefined }, { ...second, type: "episode" }, third];
		const server = serve(
			items(existingPlaylistKey, (start) =>
				Response.json({
					MediaContainer: { totalSize: 3, Metadata: start === 0 ? odd : [] },
				}),
			),
		);

		const { songs, logs } = await readInputs(server, { source: "all", exclude: "smart*, twice" });

		expect(songs.playlists[1]?.songs.map((song) => song.title)).toEqual(["Sneaky Snitch"]);
		expect(warnings(logs)).toEqual([expect.stringContaining(`"${title}"`)]);
	});
});

describe("failures", () => {
	test("a playlist deleted before its items are read is skipped with a warning", async () => {
		const server = serve(items(smartPlaylistKey, () => notFound()));

		const { songs, logs } = await readInputs(server, { source: "chosen", playlists: title });

		expect(songs.playlists.map((playlist) => playlist.id?.[idSpace])).toEqual([
			existingPlaylistKey,
		]);
		// The shared title earns one warning of its own; the deletion earns the other.
		expect(warnings(logs)).toHaveLength(2);
	});

	test("a refused token throws the output's invalid-credentials error", async () => {
		const server = serve();

		const read = readInputs(server, { source: "all" }, { serverUrl: server.url, token: "wrong" });

		expect(read).rejects.toMatchObject({ name: "PlexError", code: "invalid-credentials" });
		await read.catch(() => {});
	});

	test("a 401 on a playlist's items throws rather than skipping it", async () => {
		const server = serve(items(smartPlaylistKey, () => new Response("", { status: 401 })));

		await expect(readInputs(server, { source: "all" })).rejects.toMatchObject({
			code: "invalid-credentials",
		});
	});

	test("any other refusal of a playlist's items throws", async () => {
		const server = serve(items(smartPlaylistKey, () => new Response("", { status: 500 })));

		await expect(readInputs(server, { source: "all" })).rejects.toMatchObject({
			code: "service-error",
			status: 500,
		});
	});

	test("an unreachable server throws the output's unreachable error", async () => {
		const url = await unreachableUrl();
		const server = serve();

		await expect(
			readInputs(server, { source: "all" }, { serverUrl: url, token: fakeToken }),
		).rejects.toMatchObject({ code: "unreachable" });
	});

	test("the token is in no request URL, log line or error", async () => {
		const server = serve(items("49", () => notFound()));

		const { logs } = await readInputs(server, { source: "all" });
		const refused = await readInputs(
			server,
			{ source: "all" },
			{
				serverUrl: server.url,
				token: `${fakeToken}-wrong`,
			},
		).catch((error: Error) => error.message);

		for (const text of [
			...server.requests.map((request) => request.url),
			...logs.map((entry) => entry.message),
			String(refused),
		]) {
			expect(text).not.toContain(fakeToken);
		}
	});
});
