import { afterEach, describe, expect, test } from "bun:test";
import {
	createRunContext,
	type LogEntry,
	type Plugin,
	RunPayload,
	type SongDictInput,
	StrictSongDict,
} from "@ultrasonics/plugin-sdk";
import {
	type FakeDeezer,
	fixture,
	playlistIds,
	quotaExceeded,
	type Route,
	startFakeDeezer,
	times,
	unreachableApiBase,
} from "../test/fake-deezer.ts";
import { quota } from "./deezer-client.ts";
import { createDeezerPlugin } from "./index.ts";
import { copyFullAddress } from "./input-settings.ts";

let fake: FakeDeezer | undefined;
afterEach(async () => {
	await fake?.stop();
	fake = undefined;
});

function serve(...routes: Route[]): FakeDeezer {
	fake = startFakeDeezer(routes);
	return fake;
}

/** Runs the `inputs` handler through the SDK harness, as the runner would. */
async function readInputs(
	apiBase: string,
	playlists: string,
	options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ songs: SongDictInput; logs: LogEntry[] }> {
	const plugin: Plugin = createDeezerPlugin({
		apiBase,
		sleep: options.sleep ?? (async () => {}),
	});
	const logs: LogEntry[] = [];
	const payload = RunPayload.parse({
		component: "inputs",
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: "/nonexistent",
		persistent: {},
		instance: plugin.instanceSettings.inputs?.parse({ playlists }),
	});
	const context = createRunContext(
		payload,
		{
			credentials: async () => {
				throw new Error("deezer asked for credentials");
			},
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: false },
	);
	const songs = await plugin.run.inputs?.(context);
	if (songs === undefined) throw new Error("deezer has no inputs handler");
	return { songs, logs };
}

const lines = (logs: LogEntry[], level: LogEntry["level"]) =>
	logs.filter((entry) => entry.level === level).map((entry) => entry.message);

describe("reading a public playlist", () => {
	test("maps the playlist and its tracks into the song dict", async () => {
		const server = serve();
		const { songs } = await readInputs(
			server.apiBase,
			`https://www.deezer.com/en/playlist/${playlistIds.eighties}`,
		);

		expect(StrictSongDict.safeParse(songs).success).toBe(true);
		const [playlist] = songs.playlists;
		expect(playlist?.name).toBe("80s HITS - 100 Greatest Songs of the 1980s");
		expect(playlist?.description).toStartWith("Best of 80s pop, rock, and new wave");
		expect(playlist?.id).toEqual({ deezer: "11798808421" });
		expect(playlist?.songs).toHaveLength(100);
		expect(playlist?.songs.slice(0, 2)).toEqual([
			{
				title: "Take on Me",
				artists: ["a-ha"],
				album: "Hunting High and Low",
				isrc: "USWB19901214",
				durationMs: 227_000,
				explicit: false,
				id: { deezer: "664107" },
			},
			// Unavailable in the recording's country (`readable: false`), and carried all the same.
			{
				title: "Into the Groove",
				artists: ["Madonna"],
				album: "Celebration (double disc version)",
				isrc: "USWB10903605",
				durationMs: 285_000,
				explicit: false,
				id: { deezer: "4209638" },
			},
		]);
	});
});

/** The 80s playlist's details and first page, rewritten by `edit`. */
async function editedEighties(
	edit: (details: Record<string, unknown>, tracks: Record<string, unknown>[]) => void,
): Promise<Route[]> {
	const details = (await fixture("playlist-80s.json")) as Record<string, unknown>;
	const { data } = (await fixture("playlist-80s-tracks.json")) as {
		data: Record<string, unknown>[];
	};
	const tracks = data.slice(0, 3).map((track) => structuredClone(track));
	edit(details, tracks);
	return [
		times(1, `/playlist/${playlistIds.eighties}`, () => Response.json(details)),
		times(1, `/playlist/${playlistIds.eighties}/tracks`, () =>
			Response.json({ data: tracks, total: tracks.length }),
		),
	];
}

describe("blanks", () => {
	test("leaves out blank fields, skips an untitled track, and warns once for the playlist", async () => {
		const routes = await editedEighties((details, tracks) => {
			details.description = "  ";
			Object.assign(tracks[0] ?? {}, { title: "  ", isrc: "" });
			Object.assign(tracks[1] ?? {}, { title: "   " });
			Object.assign(tracks[2] ?? {}, {
				title: "  Sweet Dreams  ",
				isrc: "",
				album: { title: " " },
				artist: { name: "" },
			});
		});
		const server = serve(...routes);
		const { songs, logs } = await readInputs(server.apiBase, playlistIds.eighties);

		expect(StrictSongDict.safeParse(songs).success).toBe(true);
		const [playlist] = songs.playlists;
		expect(playlist).not.toHaveProperty("description");
		expect(playlist?.songs).toEqual([
			{
				title: "Sweet Dreams",
				artists: [],
				durationMs: 212_000,
				explicit: false,
				id: { deezer: "14638333" },
			},
		]);
		const warnings = lines(logs, "warn");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('"80s HITS - 100 Greatest Songs of the 1980s"');
		expect(warnings[0]).toContain("skipped 2 songs");
	});
});

describe("choosing playlists", () => {
	test("takes links and bare ids, in the order given, reading a duplicate once", async () => {
		const server = serve();
		const { songs } = await readInputs(
			server.apiBase,
			[
				`https://deezer.com/fr/playlist/${playlistIds.rock}?utm_source=deezer&utm_medium=web`,
				playlistIds.eighties,
				`https://www.deezer.com/playlist/${playlistIds.rock}/`,
			].join(", "),
		);
		expect(songs.playlists.map((playlist) => playlist.id)).toEqual([
			{ deezer: playlistIds.rock },
			{ deezer: playlistIds.eighties },
		]);
		const detailReads = server.requests.filter((r) => /^\/playlist\/\d+$/.test(r.path));
		expect(detailReads.map((r) => r.path)).toEqual([
			`/playlist/${playlistIds.rock}`,
			`/playlist/${playlistIds.eighties}`,
		]);
	});

	test("reads a 1,000-song playlist in full, ten pages of 100 by next, and no track", async () => {
		const server = serve();
		const { songs } = await readInputs(server.apiBase, playlistIds.rock);

		const read = songs.playlists[0]?.songs ?? [];
		expect(read).toHaveLength(1000);
		expect(read[0]?.title).toBe("Believer");
		expect(read[999]?.id).toEqual({ deezer: "7087581" });
		const pages = server.requests.filter((r) => r.path.endsWith("/tracks"));
		expect(pages.map((r) => r.query.get("index"))).toEqual([
			null,
			"100",
			"200",
			"300",
			"400",
			"500",
			"600",
			"700",
			"800",
			"900",
		]);
		expect(pages.every((r) => r.query.get("limit") === "100")).toBe(true);
		expect(server.requests.some((r) => r.path.startsWith("/track/"))).toBe(false);
	});

	test("skips a private and a missing playlist with a warning naming each, and reads the rest", async () => {
		const server = serve();
		const { songs, logs } = await readInputs(
			server.apiBase,
			[playlistIds.private, playlistIds.missing, playlistIds.eighties].join(","),
		);
		expect(songs.playlists.map((playlist) => playlist.id)).toEqual([
			{ deezer: playlistIds.eighties },
		]);
		const warnings = lines(logs, "warn");
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain(`playlist ${playlistIds.private}:`);
		expect(warnings[0]).toContain("OAuthException");
		expect(warnings[1]).toContain(`playlist ${playlistIds.missing}:`);
		expect(warnings[1]).toContain("800");
	});
});

describe("Deezer's quota", () => {
	const recordSleeps = () => {
		const sleeps: number[] = [];
		return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
	};

	test("waits out code 4 and retries, logging each wait", async () => {
		const server = serve(times(2, `/playlist/${playlistIds.eighties}/tracks`, quotaExceeded));
		const { sleeps, sleep } = recordSleeps();
		const { songs, logs } = await readInputs(server.apiBase, playlistIds.eighties, { sleep });

		expect(songs.playlists[0]?.songs).toHaveLength(100);
		expect(sleeps).toEqual([quota.waitMs, quota.waitMs]);
		expect(lines(logs, "info").filter((line) => line.includes("quota"))).toHaveLength(2);
	});

	test("throws once one request has been retried as often as allowed", async () => {
		const path = `/playlist/${playlistIds.eighties}`;
		const server = serve(times(quota.retriesPerRequest + 1, path, quotaExceeded));
		const { sleeps, sleep } = recordSleeps();
		const read = readInputs(server.apiBase, playlistIds.eighties, { sleep });

		await expect(read).rejects.toMatchObject({ code: "quota" });
		expect(sleeps).toHaveLength(quota.retriesPerRequest);
	});

	test("throws once the run has waited as long as allowed", async () => {
		// Every other request is refused once, so no request reaches its own retry bound.
		let refuse = true;
		const server = serve(() => {
			refuse = !refuse;
			return refuse ? undefined : quotaExceeded();
		});
		const { sleeps, sleep } = recordSleeps();
		const read = readInputs(server.apiBase, `${playlistIds.rock},${playlistIds.eighties}`, {
			sleep,
		});

		await expect(read).rejects.toMatchObject({ code: "quota" });
		expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(quota.totalWaitMs);
	});
});

describe("failures", () => {
	test("throws on any other Deezer error", async () => {
		const server = serve(() =>
			Response.json({
				error: { type: "ParameterException", message: "Wrong parameter", code: 500 },
			}),
		);
		await expect(readInputs(server.apiBase, playlistIds.eighties)).rejects.toMatchObject({
			code: "service-error",
		});
	});

	test("throws on a status other than 200", async () => {
		// A body that would otherwise read, so only the status can fail it.
		const server = serve(async (request) =>
			request.path.endsWith("/tracks")
				? Response.json(await fixture("playlist-80s-tracks.json"), { status: 503 })
				: undefined,
		);
		await expect(readInputs(server.apiBase, playlistIds.eighties)).rejects.toMatchObject({
			code: "service-error",
		});
	});

	test("throws when Deezer can't be reached", async () => {
		await expect(
			readInputs(await unreachableApiBase(), playlistIds.eighties),
		).rejects.toMatchObject({ code: "unreachable" });
	});
});

describe("settings", () => {
	test("refuses a short link on playlists, saying to copy the full address", () => {
		const plugin = createDeezerPlugin({ apiBase: "http://127.0.0.1:1" });
		const parsed = plugin.instanceSettings.inputs.safeParse({
			playlists: `${playlistIds.eighties}, https://link.deezer.com/s/31ZQ0xYzAbC`,
		});
		expect(parsed.error?.issues).toHaveLength(1);
		expect(parsed.error?.issues[0]?.path).toEqual(["playlists"]);
		expect(parsed.error?.issues[0]?.message).toContain(copyFullAddress);
	});
});
