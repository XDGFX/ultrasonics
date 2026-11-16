import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	existingPlaylistKey,
	type FakePlex,
	fakeToken,
	firstCreatedKey,
	fixture,
	machineIdentifier,
	on,
	type Route,
	startFakePlex,
	unreachableUrl,
} from "../test/fake-plex.ts";
import plex from "./index.ts";
import { batchSize } from "./playlist-output.ts";
import { maxResponseBytes, PlexError } from "./plex-client.ts";

/** The plugin as the runner holds it, so its handlers take the contexts the harness builds. */
const plugin: Plugin = plex;

function grant(credentials: Record<string, unknown>): unknown {
	if (plugin.auth === undefined) throw new Error("plex declares no auth");
	return plugin.auth.fields.parse(credentials);
}

let fake: FakePlex | undefined;
/** The plugin's config directory; every run in one test shares it, as one install's runs do. */
let configDir: string;
beforeEach(() => {
	configDir = mkdtempSync(join(tmpdir(), "ultrasonics-plex-test-"));
});
afterEach(async () => {
	await fake?.stop();
	fake = undefined;
	rmSync(configDir, { recursive: true, force: true });
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
	appletId = "applet",
): Promise<Run> {
	const logs: LogEntry[] = [];
	const payload = RunPayload.parse({
		component: "outputs",
		appletId,
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir,
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

// Tracks in the recorded library, with their rating keys there.
const sneakySnitch = { title: "Sneaky Snitch", artists: ["Kevin MacLeod"], durationMs: 136620 };
const fluffingADuck = { title: "Fluffing a Duck", artists: ["Kevin MacLeod"] };
const sneakySnitchKey = "25";
const fluffingADuckKey = "27";
/** The recorded traps: a curly apostrophe, a colon, a non-ASCII letter; and a plain title. */
const trapKeys = {
	mirisMagicDance: "12",
	pixelPeekerPolka: "3",
	bossaAntigua: "7",
	wallpaper: "17",
};

/** The ordinary playlist the recorded server holds, and its title. */
const existing = { key: existingPlaylistKey, title: "ultrasonics Plex test" };

/** The rating keys a write request names, from its `server://…/library/metadata/<keys>` URI. */
function keysOf(uri: string | null): string[] {
	const prefix = `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/`;
	expect(uri?.startsWith(prefix)).toBe(true);
	return (uri ?? "").slice(prefix.length).split(",");
}

function warnings(logs: LogEntry[]): string[] {
	return logs.filter((entry) => entry.level === "warn").map((entry) => entry.message);
}

function writes(server: FakePlex) {
	return server.requests.filter((request) => request.method !== "GET");
}

describe("writing playlists", () => {
	test("creates a missing playlist holding the matched tracks in source order", async () => {
		const server = serve();
		const { result } = await runOutput(server, playlist("New Mix", [fluffingADuck, sneakySnitch]));

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		const [create, ...rest] = writes(server);
		expect(rest).toEqual([]);
		expect(create?.method).toBe("POST");
		expect(create?.path).toBe("/playlists");
		expect(create?.query.get("title")).toBe("New Mix");
		expect(create?.query.get("type")).toBe("audio");
		expect(create?.query.get("smart")).toBe("0");
		expect(keysOf(create?.query.get("uri") ?? null)).toEqual([fluffingADuckKey, sneakySnitchKey]);
	});

	test("append adds only the matched tracks the playlist doesn't hold, at the end", async () => {
		const server = serve();
		// The existing playlist already holds Sneaky Snitch.
		const before = server.existingPlaylist();
		const { result } = await runOutput(
			server,
			playlist(existing.title, [sneakySnitch, fluffingADuck]),
		);

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		const [add, ...rest] = writes(server);
		expect(rest).toEqual([]);
		expect(add?.method).toBe("PUT");
		expect(add?.path).toBe(`/playlists/${existing.key}/items`);
		expect(keysOf(add?.query.get("uri") ?? null)).toEqual([fluffingADuckKey]);
		expect(server.existingPlaylist()).toEqual([...before, fluffingADuckKey]);
	});

	test("create reports a repeated song, which Plex can't hold twice, as not written", async () => {
		const server = serve();
		const { result, logs } = await runOutput(
			server,
			playlist("New Mix", [sneakySnitch, fluffingADuck, sneakySnitch]),
		);

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [2] }] });
		expect(server.playlist(firstCreatedKey)).toEqual([sneakySnitchKey, fluffingADuckKey]);
		expect(warnings(logs)).toEqual([expect.stringContaining('"New Mix"')]);
	});

	test("append reports a match Plex refused to add as not written", async () => {
		const added = await fixture("playlist-items-added.json");
		const server = serve(on("PUT", `/playlists/${existing.key}/items`, () => Response.json(added)));
		// The playlist holds Sneaky Snitch already; Plex answers the add of Fluffing a Duck but drops it.
		const { result, logs } = await runOutput(
			server,
			playlist(existing.title, [sneakySnitch, fluffingADuck]),
		);

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [1] }] });
		expect(warnings(logs)).toEqual([expect.stringContaining(`"${existing.title}"`)]);
	});

	test("append sends nothing when the playlist already holds every match", async () => {
		const server = serve();
		const { result } = await runOutput(server, playlist(existing.title, [sneakySnitch]));

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		expect(writes(server)).toEqual([]);
	});

	test("update leaves the playlist holding exactly the matches, in source order", async () => {
		const server = serve();
		// It holds Sneaky Snitch already, and Plex won't add a track a playlist holds.
		expect(server.existingPlaylist()).toContain(sneakySnitchKey);
		const { result } = await runOutput(
			server,
			playlist(existing.title, [fluffingADuck, sneakySnitch]),
			{ existing: "update" },
		);

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		expect(server.existingPlaylist()).toEqual([fluffingADuckKey, sneakySnitchKey]);
	});

	test("update that fails to add removes nothing, so the old playlist survives", async () => {
		const server = serve(
			on("PUT", `/playlists/${existing.key}/items`, () => new Response(null, { status: 500 })),
		);
		const before = server.existingPlaylist();
		const { result } = await runOutput(server, playlist(existing.title, [fluffingADuck]), {
			existing: "update",
		});

		expect(result.playlists[0]).toMatchObject({ status: "failed", code: "service-error" });
		expect(server.existingPlaylist()).toEqual(before);
	});

	test("update that Plex answers without adding removes nothing", async () => {
		const added = await fixture("playlist-items-added.json");
		const server = serve(on("PUT", `/playlists/${existing.key}/items`, () => Response.json(added)));
		const before = server.existingPlaylist();
		const { result } = await runOutput(server, playlist(existing.title, [fluffingADuck]), {
			existing: "update",
		});

		expect(result.playlists[0]).toMatchObject({ status: "failed", code: "service-error" });
		expect(server.existingPlaylist()).toEqual(before);
	});

	test("ignores smart and video playlists that share the title", async () => {
		const server = serve();
		// `Smart only` exists only as a smart audio playlist and a video playlist.
		const { result } = await runOutput(server, playlist("Smart only", [sneakySnitch]));

		expect(result.playlists[0]?.status).toBe("written");
		expect(writes(server).map((request) => `${request.method} ${request.path}`)).toEqual([
			"POST /playlists",
		]);
	});

	test("skips a title two ordinary audio playlists share", async () => {
		const server = serve();
		const { result, logs } = await runOutput(server, playlist("Twice", [sneakySnitch]));

		expect(result.playlists[0]).toMatchObject({ status: "skipped", code: "ambiguous-playlist" });
		expect(writes(server)).toEqual([]);
		expect(logs.some((entry) => entry.level === "warn")).toBe(true);
	});

	test("writes a playlist longer than one batch in several requests, in order", async () => {
		const keys = Array.from({ length: batchSize + 3 }, (_, index) => String(2000 + index));
		const track = { ...(await trackFixture(sneakySnitchKey)), librarySectionID: 1 };
		const server = serve((request) => {
			const key = /^\/library\/metadata\/(2\d{3})$/.exec(request.path)?.[1];
			return key === undefined
				? undefined
				: Response.json({ MediaContainer: { size: 1, Metadata: [{ ...track, ratingKey: key }] } });
		});
		const songs = keys.map((key) => ({
			...sneakySnitch,
			id: { [`plex:${machineIdentifier}`]: key },
		}));
		const { result } = await runOutput(server, playlist("Long", songs));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		const sent = writes(server);
		expect(sent.map((request) => request.method)).toEqual(["POST", "PUT"]);
		expect(sent.flatMap((request) => keysOf(request.query.get("uri")))).toEqual(keys);
	});
});

describe("linking source playlists to Plex playlists", () => {
	const modes = ["append", "update"] as const;

	/** Two source playlists both called `name`, with their own ids, one song each. */
	function sameName(name: string): SongDictInput {
		return {
			playlists: [
				{ name, id: { spotify: "a" }, songs: [sneakySnitch] },
				{ name, id: { spotify: "b" }, songs: [fluffingADuck] },
			],
		};
	}

	for (const mode of modes) {
		test(`two source playlists sharing a name not in Plex each get their own (${mode})`, async () => {
			const server = serve();
			const { result, logs } = await runOutput(server, sameName("Mix"), { existing: mode });

			expect(result.playlists).toEqual([
				{ status: "written", playlist: 0, unmatched: [] },
				{ status: "written", playlist: 1, unmatched: [] },
			]);
			const [first, second] = server.created();
			expect(server.created().map((created) => created.title)).toEqual(["Mix", "Mix"]);
			expect(server.playlist(first?.key ?? "")).toEqual([sneakySnitchKey]);
			expect(server.playlist(second?.key ?? "")).toEqual([fluffingADuckKey]);
			expect(warnings(logs)).toEqual([expect.stringContaining('"Mix"')]);
		});

		test(`two source playlists sharing an existing Plex title: the first takes it, the second gets its own (${mode})`, async () => {
			const server = serve();
			const before = server.existingPlaylist();
			// The existing playlist holds Sneaky Snitch, not Fluffing a Duck.
			const { result, logs } = await runOutput(
				server,
				{
					playlists: [
						{ name: existing.title, id: { spotify: "a" }, songs: [fluffingADuck] },
						{ name: existing.title, id: { spotify: "b" }, songs: [sneakySnitch] },
					],
				},
				{ existing: mode },
			);

			expect(result.playlists).toEqual([
				{ status: "written", playlist: 0, unmatched: [] },
				{ status: "written", playlist: 1, unmatched: [] },
			]);
			expect(server.existingPlaylist()).toEqual(
				mode === "append" ? [...before, fluffingADuckKey] : [fluffingADuckKey],
			);
			const [own, ...rest] = server.created();
			expect(rest).toEqual([]);
			expect(own?.title).toBe(existing.title);
			expect(server.playlist(own?.key ?? "")).toEqual([sneakySnitchKey]);
			expect(warnings(logs)).toEqual([expect.stringContaining(`"${existing.title}"`)]);
		});
	}

	test("a later run follows the links, so a shared title is never ambiguous", async () => {
		const server = serve();
		await runOutput(server, sameName("Mix"));
		const [first, second] = server.created();
		const { result } = await runOutput(server, {
			playlists: [
				{ name: "Mix", id: { spotify: "a" }, songs: [sneakySnitch, fluffingADuck] },
				{ name: "Mix", id: { spotify: "b" }, songs: [fluffingADuck] },
			],
		});

		expect(result.playlists.map((entry) => entry.status)).toEqual(["written", "written"]);
		expect(server.created()).toHaveLength(2);
		expect(server.playlist(first?.key ?? "")).toEqual([sneakySnitchKey, fluffingADuckKey]);
		expect(server.playlist(second?.key ?? "")).toEqual([fluffingADuckKey]);
	});

	test("a source playlist renamed since is still written to its linked playlist", async () => {
		const server = serve();
		await runOutput(server, {
			playlists: [{ name: "Old name", id: { spotify: "a" }, songs: [sneakySnitch] }],
		});
		const { result } = await runOutput(server, {
			playlists: [{ name: "New name", id: { spotify: "a" }, songs: [fluffingADuck] }],
		});

		expect(result.playlists[0]?.status).toBe("written");
		const [linked, ...rest] = server.created();
		expect(rest).toEqual([]);
		expect(server.playlist(linked?.key ?? "")).toEqual([sneakySnitchKey, fluffingADuckKey]);
	});

	test("a linked playlist deleted in Plex is found by name again, and the new one linked", async () => {
		const server = serve();
		const mix = { name: "Mix", id: { spotify: "a" }, songs: [sneakySnitch] };
		await runOutput(server, { playlists: [mix] });
		const [gone] = server.created();
		server.deletePlaylist(gone?.key ?? "");

		await runOutput(server, { playlists: [mix] });
		const [replacement, ...rest] = server.created();
		expect(rest).toEqual([]);
		expect(replacement?.key).not.toBe(gone?.key);

		await runOutput(server, { playlists: [{ ...mix, name: "Renamed" }] });
		expect(server.created()).toEqual([{ key: replacement?.key ?? "", title: "Mix" }]);
	});

	test("a linked playlist deleted in Plex falls back to an existing playlist of that name", async () => {
		const server = serve();
		const source = { name: "Elsewhere", id: { spotify: "a" }, songs: [sneakySnitch] };
		await runOutput(server, { playlists: [source] });
		const [gone] = server.created();
		server.deletePlaylist(gone?.key ?? "");
		const before = server.existingPlaylist();

		await runOutput(server, {
			playlists: [{ ...source, name: existing.title, songs: [fluffingADuck] }],
		});
		expect(server.created()).toEqual([]);
		expect(server.existingPlaylist()).toEqual([...before, fluffingADuckKey]);
	});

	test("a source playlist with no id is found by name every run", async () => {
		const server = serve();
		await runOutput(server, playlist("Mix", [sneakySnitch]));
		await runOutput(server, playlist("Mix", [fluffingADuck]));

		const [mix, ...rest] = server.created();
		expect(rest).toEqual([]);
		expect(server.playlist(mix?.key ?? "")).toEqual([sneakySnitchKey, fluffingADuckKey]);
		expect(readdirSync(configDir)).toEqual([]);
	});

	test("a Plex playlist linked to one source playlist is never taken by name for another", async () => {
		const server = serve();
		await runOutput(server, {
			playlists: [{ name: "Mix", id: { spotify: "a" }, songs: [sneakySnitch] }],
		});
		const { logs } = await runOutput(server, {
			playlists: [{ name: "Mix", id: { spotify: "b" }, songs: [fluffingADuck] }],
		});

		const [first, second] = server.created();
		expect(server.playlist(first?.key ?? "")).toEqual([sneakySnitchKey]);
		expect(server.playlist(second?.key ?? "")).toEqual([fluffingADuckKey]);
		expect(warnings(logs)).toEqual([expect.stringContaining('"Mix"')]);
	});

	test("the link is kept under the ID space that sorts first", async () => {
		const server = serve();
		await runOutput(server, {
			playlists: [{ name: "Mix", id: { spotify: "s", deezer: "d" }, songs: [sneakySnitch] }],
		});
		// Only the `deezer` id survives into the next run, under a new name.
		await runOutput(server, {
			playlists: [{ name: "Renamed", id: { deezer: "d" }, songs: [fluffingADuck] }],
		});

		expect(server.created()).toHaveLength(1);
	});

	test("links belong to one applet", async () => {
		const server = serve();
		const source = { name: "Mix", id: { spotify: "a" }, songs: [sneakySnitch] };
		await runOutput(server, { playlists: [source] }, {}, undefined, "first-applet");
		await runOutput(
			server,
			{ playlists: [{ ...source, name: "Renamed" }] },
			{},
			undefined,
			"second-applet",
		);

		expect(server.created().map((created) => created.title)).toEqual(["Mix", "Renamed"]);
	});

	test("a links file that can't be read is started afresh, with a warning", async () => {
		const server = serve();
		const source = { name: "Mix", id: { spotify: "a" }, songs: [sneakySnitch] };
		await runOutput(server, { playlists: [source] });
		const [file] = readdirSync(join(configDir, "playlist-links"));
		writeFileSync(join(configDir, "playlist-links", file ?? ""), "{ not json");

		const { result, logs } = await runOutput(server, { playlists: [source] });
		expect(result.playlists[0]?.status).toBe("written");
		expect(warnings(logs)).toHaveLength(1);
		// Found by name, so it was written to the playlist it made before, and linked again.
		expect(server.created()).toHaveLength(1);
		await runOutput(server, { playlists: [{ ...source, name: "Renamed" }] });
		expect(server.created()).toHaveLength(1);
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
				{ name: "First", songs: [sneakySnitch] },
				{ name: "Second", songs: [sneakySnitch] },
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
		const { result } = await runOutput(server, playlist("Mixed", [nobody, sneakySnitch, nobody]));

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
			request.query.get("title") === fluffingADuck.title
				? new Response("Bad Request", { status: 400 })
				: undefined,
		);
		const { result } = await runOutput(server, playlist("Mix", [fluffingADuck, sneakySnitch]));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [0] });
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual([sneakySnitchKey]);
	});

	test("a song in this server's ID space is written straight to its track", async () => {
		const server = serve();
		const song = {
			title: "Renamed Elsewhere",
			artists: [],
			id: { [`plex:${machineIdentifier}`]: fluffingADuckKey },
		};
		const { result } = await runOutput(server, playlist("Mix", [song]));

		expect(result.playlists[0]?.status).toBe("written");
		expect(searchedTitles(server)).toEqual([]);
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual([fluffingADuckKey]);
	});

	const album = { ratingKey: "1101", type: "album", title: "Sneaky Snitch", librarySectionID: 1 };
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
			sneakySnitchKey,
			[
				on(
					"GET",
					`/library/metadata/${sneakySnitchKey}`,
					() => new Response(null, { status: 500 }),
				),
			],
		],
	];
	for (const [name, ratingKey, routes] of ownIdCases) {
		test(`a song whose own ID ${name} falls through to search`, async () => {
			const server = serve(...routes);
			const song = { ...sneakySnitch, id: { [`plex:${machineIdentifier}`]: ratingKey } };
			const { result } = await runOutput(server, playlist("Mix", [song]));

			expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
			expect(searchedTitles(server)).toEqual([sneakySnitch.title]);
			expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual([sneakySnitchKey]);
		});
	}

	test("a bracketed title is searched again cut before the bracket", async () => {
		const server = serve();
		const song = { ...sneakySnitch, title: "Sneaky Snitch (2009 Remaster)" };
		const { result } = await runOutput(server, playlist("Mix", [song]));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		expect(searchedTitles(server)).toEqual([song.title, sneakySnitch.title]);
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual([sneakySnitchKey]);
	});

	test("a straight apostrophe finds a track titled with a curly one", async () => {
		// Plex's title search tells ' from ’, as the fake's does.
		const server = serve();
		const song = { title: "Miri's Magic Dance", artists: ["Kevin MacLeod"] };
		const { result } = await runOutput(server, playlist("Mix", [song]));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual([trapKeys.mirisMagicDance]);
	});

	test("a song with only a title and a file location can match (#49)", async () => {
		const server = serve();
		const song = {
			title: "Wallpaper",
			artists: [],
			location: "file:///music/main/Kevin%20MacLeod/Light%20Electronic/02%20-%20Wallpaper.mp3",
		};
		const { result } = await runOutput(server, playlist("From m3u", [song]));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		expect(keysOf(writes(server)[0]?.query.get("uri") ?? null)).toEqual([trapKeys.wallpaper]);
	});

	test("curly quotes, colons and non-ASCII names reach Plex intact", async () => {
		const server = serve();
		const titles = ["Miri’s Magic Dance", "Pixel Peeker Polka: Faster", "Bossa Antígua"];
		const songs = titles.map((title) => ({ title, artists: ["Kevin MacLeod"] }));
		const { result } = await runOutput(server, playlist("Polka & Bossa — ünïcödé", songs));

		expect(result.playlists[0]).toEqual({ status: "written", playlist: 0, unmatched: [] });
		expect(searchedTitles(server)).toEqual(titles);
		const [create] = writes(server);
		expect(create?.query.get("title")).toBe("Polka & Bossa — ünïcödé");
		expect(keysOf(create?.query.get("uri") ?? null)).toEqual([
			trapKeys.mirisMagicDance,
			trapKeys.pixelPeekerPolka,
			trapKeys.bossaAntigua,
		]);
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
		await runOutput(server, playlist("Mix", [sneakySnitch]));

		expect(searchedSections(server)).toEqual(["/library/sections/1/all"]);
	});

	test("a title matches without regard to case", async () => {
		const server = serve(sections(twoMusic));
		await runOutput(server, playlist("Mix", [sneakySnitch]), { library: "MUSIC 2" });

		expect(searchedSections(server)).toEqual(["/library/sections/2/all"]);
	});

	test("a bare section id names its library", async () => {
		const server = serve(sections(twoMusic));
		await runOutput(server, playlist("Mix", [sneakySnitch]), { library: "2" });

		expect(searchedSections(server)).toEqual(["/library/sections/2/all"]);
	});

	const unresolvable: [string, unknown, string | undefined][] = [
		["blank with several music libraries", twoMusic, undefined],
		["an unknown title", twoMusic, "Podcasts"],
		["a library that isn't music", twoMusic, "Films"],
		["the section id of a library that isn't music", twoMusic, "3"],
	];
	for (const [name, body, library] of unresolvable) {
		test(`${name} throws misconfigured, listing the music libraries`, async () => {
			const server = serve(sections(body));
			const run = runOutput(server, playlist("Mix", [sneakySnitch]), { library });

			const error = await run.catch((thrown: unknown) => thrown);
			expect(error).toMatchObject({ code: "misconfigured" });
			expect(String((error as Error).message)).toContain('"Music", "Music 2"');
			expect(searchedSections(server)).toEqual([]);
			expect(writes(server)).toEqual([]);
		});
	}

	test("two music libraries sharing the title throw misconfigured", async () => {
		const duplicated = structuredClone(twoMusic) as {
			MediaContainer: { Directory: { title: string }[] };
		};
		for (const directory of duplicated.MediaContainer.Directory) {
			if (directory.title === "Music 2") directory.title = "Music";
		}
		const server = serve(sections(duplicated));

		const error = await runOutput(server, playlist("Mix", [sneakySnitch]), {
			library: "music",
		}).catch((thrown: unknown) => thrown);
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
			playlist("Mix", [sneakySnitch]),
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
			playlist("Mix", [sneakySnitch]),
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
		const error = await runOutput(server, playlist("Mix", [sneakySnitch])).catch(
			(thrown: unknown) => thrown,
		);

		expect(error).toMatchObject({ code: "invalid-credentials" });
	});

	describe("a redirect is refused, so the token never reaches the host it points at", () => {
		let elsewhere: FakePlex | undefined;
		afterEach(async () => {
			await elsewhere?.stop();
			elsewhere = undefined;
		});

		/** A second server, and a redirect to it carrying a query that must not be repeated. */
		function redirectElsewhere(status: number) {
			elsewhere = startFakePlex();
			const location = `${elsewhere.url}login?rd=secret-query`;
			return () => new Response(null, { status, headers: { Location: location } });
		}

		test("on connect, the run throws misconfigured, naming the server and nothing the redirect said", async () => {
			const server = serve(on("GET", "/", redirectElsewhere(302)));
			const error = await runOutput(server, playlist("Mix", [sneakySnitch])).catch(
				(thrown: unknown) => thrown,
			);

			expect(elsewhere?.requests).toEqual([]);
			expect(error).toMatchObject({ code: "misconfigured" });
			const { message } = error as Error;
			expect(message).toContain(new URL(server.url).origin);
			// The target comes from the answer's `Location`, which is response content.
			expect(message).not.toContain(new URL(elsewhere?.url ?? "http://unset").origin);
			expect(message).not.toContain("secret-query");
			expect(message).not.toContain(fakeToken);
		});

		test("on a write, that playlist fails and nothing is replayed", async () => {
			const server = serve(on("POST", "/playlists", redirectElsewhere(307)));
			const { result } = await runOutput(server, playlist("Mix", [sneakySnitch]));

			expect(elsewhere?.requests).toEqual([]);
			expect(result.playlists[0]).toMatchObject({ status: "failed", code: "service-error" });
		});

		test("test() reports misconfigured", async () => {
			const server = serve(on("GET", "/", redirectElsewhere(308)));
			const context = createTestContext(
				{ persistent: {}, configDir: "/nonexistent" },
				{
					credentials: async () => grant({ serverUrl: server.url, token: fakeToken }),
					log: () => {},
				},
				{ declaresAuth: true },
			);
			const result = await plugin.test?.(context);

			expect(elsewhere?.requests).toEqual([]);
			expect(result).toMatchObject({ ok: false, code: "misconfigured" });
		});
	});

	describe("whatever answers at the server URL, a response can't fill memory or be read back", () => {
		/** A body that never ends: a server that streams until the request gives up. */
		function endless(): Response {
			const chunk = new Uint8Array(1024 * 1024).fill(0x20);
			return new Response(
				new ReadableStream({
					pull(controller) {
						controller.enqueue(chunk);
					},
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}

		test("a body longer than the cap fails the request, without reading the rest", async () => {
			const server = serve(on("GET", "/", endless));
			const error = await runOutput(server, playlist("Mix", [sneakySnitch])).catch(
				(thrown: unknown) => thrown,
			);

			expect(error).toMatchObject({ code: "service-error" });
			expect((error as Error).message).toContain(`${maxResponseBytes / 1024 / 1024} MiB`);
		});

		test("a body cut off partway fails as unreachable, like a request that got no answer", async () => {
			// A raw socket, since `Bun.serve` ends a failed stream cleanly: it promises a body it never sends.
			const dropping = Bun.listen({
				hostname: "127.0.0.1",
				port: 0,
				socket: {
					data(socket) {
						socket.write('HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n{"MediaContainer":');
						socket.end();
					},
				},
			});
			try {
				const error = await runOutput(
					serve(),
					playlist("Mix", [sneakySnitch]),
					{},
					{
						serverUrl: `http://127.0.0.1:${dropping.port}/`,
						token: fakeToken,
					},
				).catch((thrown: unknown) => thrown);

				expect(error).toBeInstanceOf(PlexError);
				expect(error).toMatchObject({ code: "unreachable" });
			} finally {
				dropping.stop(true);
			}
		});

		test("an answer that isn't Plex's reads the same whatever it held, and echoes none of it", async () => {
			const marker = "internal-service-banner";
			const answers = [
				() => new Response(`<html>${marker}</html>`, { headers: { "Content-Type": "text/html" } }),
				() => Response.json({ [marker]: marker }),
			];
			const messages: string[] = [];
			for (const answer of answers) {
				const server = serve(on("GET", "/", answer));
				const error = await runOutput(server, playlist("Mix", [sneakySnitch])).catch(
					(thrown: unknown) => thrown,
				);
				await server.stop();
				expect(error).toMatchObject({ code: "service-error" });
				messages.push((error as Error).message);
			}

			const [html, json] = messages;
			expect(html).toBe(json ?? "");
			expect(html).not.toContain(marker);
		});
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
			playlist("Mix", [sneakySnitch, fluffingADuck]),
			{},
			{ serverUrl, token: fakeToken },
		);
		const refused = await runOutput(
			server,
			playlist("Mix", [sneakySnitch]),
			{},
			{
				serverUrl,
				token: "revoked-token",
			},
		).catch((thrown: unknown) => thrown);
		const unreachable = await runOutput(
			server,
			playlist("Mix", [sneakySnitch]),
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
