import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createRunContext,
	createTestContext,
	type LogEntry,
	type Plugin,
	RunPayload,
	type SongDictInput,
	type SongInput,
	toFileUri,
} from "@ultrasonics/plugin-sdk";
import localMusicDatabase from "./index.ts";
import { INDEX_FILE } from "./library-index.ts";
import { MUSIC_FOLDER } from "./music-folder.ts";

const fixtures = join(import.meta.dir, "../test/fixtures");

let root: string | undefined;
afterEach(() => {
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

/** A temporary root holding a `music/` folder copied from the fixtures and an empty `config/`. */
function seed(): { music: string; configDir: string } {
	root = mkdtempSync(join(tmpdir(), "ultrasonics-local-music-database-"));
	const music = join(root, "music");
	cpSync(join(fixtures, "music"), music, { recursive: true });
	return { music, configDir: join(root, "config") };
}

interface Located {
	songs: SongDictInput;
	logs: LogEntry[];
}

/** Runs the `modifiers` handler through the SDK harness, settings parsed as the runner parses them. */
async function locate(
	songs: SongInput[],
	options: { music: string; configDir: string },
): Promise<Located> {
	const plugin: Plugin = localMusicDatabase;
	const logs: LogEntry[] = [];
	const payload = RunPayload.parse({
		component: "modifiers",
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: options.configDir,
		persistent: plugin.persistentSettings?.parse({ musicDir: options.music }),
		instance: plugin.instanceSettings.modifiers?.parse({}),
		songs: { playlists: [{ name: "Mix", songs }] },
	});
	const context = createRunContext(
		payload,
		{
			credentials: () => Promise.reject(new Error("local-music-database has no auth")),
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: false },
	);
	const result = await plugin.run.modifiers?.(context);
	if (result === undefined) throw new Error("local-music-database has no modifiers handler");
	return { songs: result, logs };
}

const lines = (logs: LogEntry[], level: LogEntry["level"]) =>
	logs.filter((entry) => entry.level === level).map((entry) => entry.message);

const locationsOf = (songs: SongDictInput) =>
	songs.playlists.flatMap((playlist) => playlist.songs.map((song) => song.location));

describe("locating songs", () => {
	test("gives a song the studio file over the live one with the same title", async () => {
		const { music, configDir } = seed();
		const { songs, logs } = await locate(
			[{ title: "Quiet Room", artists: ["Ada Lovelace"], album: "Silence Sessions", id: {} }],
			{ music, configDir },
		);
		expect(locationsOf(songs)).toEqual([
			toFileUri(join(music, "Ada Lovelace/Silence Sessions/Quiet Room.mp3")),
		]);
		expect(lines(logs, "info")).toContain('"Mix": located 1 of 1');
	});

	test("finds a file by ISRC whatever the title says", async () => {
		const { music, configDir } = seed();
		const { songs } = await locate(
			[{ title: "A Different Name", artists: ["Someone"], isrc: "GBAAA2100001", id: {} }],
			{ music, configDir },
		);
		expect(locationsOf(songs)).toEqual([
			toFileUri(join(music, "Ada Lovelace/Silence Sessions/Quiet Room.mp3")),
		]);
	});

	test("finds a file by MusicBrainz id whatever the title says", async () => {
		const { music, configDir } = seed();
		const { songs } = await locate(
			[
				{
					title: "Another Name",
					artists: ["Someone"],
					id: { musicbrainz: "8f3471b5-7e6a-48da-86a9-c1c07a0f47ae" },
				},
			],
			{ music, configDir },
		);
		expect(locationsOf(songs)).toEqual([toFileUri(join(music, "Grace Hopper/Still Air.flac"))]);
	});

	test("falls back to the title cut before a dash when the whole title finds nothing", async () => {
		const { music, configDir } = seed();
		const { songs } = await locate(
			[{ title: "Night Drive - From the Film", artists: ["Grace Hopper"], id: {} }],
			{ music, configDir },
		);
		expect(locationsOf(songs)).toEqual([toFileUri(join(music, "Grace Hopper/Night Drive.m4a"))]);
	});

	test("leaves a song with no matching file without a location, and counts it", async () => {
		const { music, configDir } = seed();
		const { songs, logs } = await locate(
			[
				{ title: "Absent Song", artists: ["Nobody"], id: {} },
				{ title: "Still Air", artists: ["Grace Hopper"], id: {} },
			],
			{ music, configDir },
		);
		expect(locationsOf(songs)).toEqual([
			undefined,
			toFileUri(join(music, "Grace Hopper/Still Air.flac")),
		]);
		expect(lines(logs, "info")).toContain('"Mix": located 1 of 2');
	});

	test("leaves a song that has a location as it was, and sets nothing but location", async () => {
		const { music, configDir } = seed();
		const own = {
			title: "Quiet Room",
			artists: ["Ada Lovelace"],
			location: "file:///elsewhere/quiet-room.mp3",
			id: {},
		};
		const bare = {
			title: "Still Air",
			artists: ["Grace Hopper"],
			explicit: false,
			id: { spotify: "x1" },
		};
		const { songs, logs } = await locate([own, bare], { music, configDir });
		expect(songs.playlists[0]?.songs).toEqual([
			own,
			{ ...bare, location: toFileUri(join(music, "Grace Hopper/Still Air.flac")) },
		]);
		expect(lines(logs, "info")).toContain('"Mix": located 1 of 1');
	});
});

/** The counts from a run's scan summary line. */
function scanned(logs: LogEntry[]) {
	const summary = lines(logs, "info")
		.map((line) => /(\d+) read, (\d+) unchanged, (\d+) removed, (\d+) unreadable/.exec(line))
		.find((match) => match !== null);
	if (!summary) throw new Error("no scan summary was logged");
	const [, read, unchanged, removed, unreadable] = summary.map(Number);
	return { read, unchanged, removed, unreadable };
}

const stillAir = { title: "Still Air", artists: ["Grace Hopper"], id: {} };

describe("scanning the music folder", () => {
	test("reads every file once, then only what changed", async () => {
		const options = seed();
		expect(scanned((await locate([], options)).logs)).toEqual({
			read: 4,
			unchanged: 0,
			removed: 0,
			unreadable: 0,
		});
		expect(scanned((await locate([], options)).logs)).toMatchObject({ read: 0, unchanged: 4 });

		const later = new Date(Date.now() + 60_000);
		utimesSync(join(options.music, "Grace Hopper/Night Drive.m4a"), later, later);
		expect(scanned((await locate([], options)).logs)).toMatchObject({ read: 1, unchanged: 3 });
	});

	test("drops a deleted file and never matches it", async () => {
		const options = seed();
		await locate([], options);
		rmSync(join(options.music, "Grace Hopper/Still Air.flac"));
		const { songs, logs } = await locate([stillAir], options);
		expect(scanned(logs)).toMatchObject({ read: 0, unchanged: 3, removed: 1 });
		expect(locationsOf(songs)).toEqual([undefined]);
	});

	test("skips hidden files and folders, and doesn't follow a symlinked folder", async () => {
		const options = seed();
		const still = join(options.music, "Grace Hopper/Still Air.flac");
		const elsewhere = join(options.configDir, "..", "elsewhere");
		mkdirSync(elsewhere);
		mkdirSync(join(options.music, ".hidden"));
		cpSync(still, join(elsewhere, "Still Air.flac"));
		cpSync(still, join(options.music, ".hidden/Still Air.flac"));
		cpSync(still, join(options.music, "Grace Hopper/.Still Air.flac"));
		symlinkSync(elsewhere, join(options.music, "Linked"), "dir");
		rmSync(still);

		const { songs, logs } = await locate([stillAir], options);
		expect(scanned(logs)).toMatchObject({ read: 3, unreadable: 0 });
		expect(locationsOf(songs)).toEqual([undefined]);
	});

	test("counts a file it can't read and carries on", async () => {
		const options = seed();
		const still = join(options.music, "Grace Hopper/Still Air.flac");
		chmodSync(still, 0o000);
		try {
			const { songs, logs } = await locate([stillAir], options);
			expect(scanned(logs)).toMatchObject({ read: 3, unreadable: 1 });
			expect(locationsOf(songs)).toEqual([undefined]);
		} finally {
			chmodSync(still, 0o644);
		}
	});

	test("counts a file whose tags can't be parsed, and never matches it", async () => {
		const options = seed();
		// The parser reads this as an MP4 whose first atom overruns the file.
		writeFileSync(join(options.music, "Grace Hopper/Broken.m4a"), "not audio at all");
		const { songs, logs } = await locate([{ title: "Broken", artists: [], id: {} }], options);
		expect(scanned(logs)).toMatchObject({ read: 4, unreadable: 1 });
		expect(locationsOf(songs)).toEqual([undefined]);
	});

	test("lets two runs share one index at once", async () => {
		const options = seed();
		const runs = await Promise.all([locate([stillAir], options), locate([stillAir], options)]);
		for (const { songs } of runs) {
			expect(locationsOf(songs)).toEqual([
				toFileUri(join(options.music, "Grace Hopper/Still Air.flac")),
			]);
		}
	});
});

describe("the index", () => {
	test("is rebuilt for a different music folder", async () => {
		const options = seed();
		await locate([], options);
		const moved = join(options.music, "..", "moved");
		cpSync(options.music, moved, { recursive: true });
		const { songs, logs } = await locate([stillAir], { ...options, music: moved });
		expect(scanned(logs)).toMatchObject({ read: 4, removed: 0 });
		expect(lines(logs, "warn")).toHaveLength(1);
		expect(locationsOf(songs)).toEqual([toFileUri(join(moved, "Grace Hopper/Still Air.flac"))]);
	});

	test("is deleted and rebuilt, with a warning, when the file is damaged", async () => {
		const options = seed();
		mkdirSync(options.configDir);
		writeFileSync(
			join(options.configDir, INDEX_FILE),
			"not a database, just some text ".repeat(200),
		);
		const { songs, logs } = await locate([stillAir], options);
		expect(lines(logs, "warn")).toHaveLength(1);
		expect(scanned(logs)).toMatchObject({ read: 4 });
		expect(locationsOf(songs)).toEqual([
			toFileUri(join(options.music, "Grace Hopper/Still Air.flac")),
		]);
	});
});

describe("the music folder", () => {
	const plugin: Plugin = localMusicDatabase;

	test("must be set, and absolute", () => {
		for (const persistent of [{}, { musicDir: " " }, { musicDir: "music" }]) {
			const parsed = plugin.persistentSettings?.safeParse(persistent);
			expect(parsed?.error?.issues.map((issue) => issue.path)).toEqual([["musicDir"]]);
		}
	});

	test("fails the run, naming the setting and the path, when it doesn't exist", async () => {
		const options = seed();
		const missing = join(options.music, "nope");
		const run = locate([stillAir], { ...options, music: missing });
		await expect(run).rejects.toThrow(MUSIC_FOLDER);
		await expect(run).rejects.toThrow(missing);
	});

	/** Calls `test()` through the SDK harness. */
	const check = (musicDir: string) =>
		plugin.test?.(
			createTestContext(
				{ persistent: { musicDir }, configDir: "/nonexistent" },
				{ credentials: () => Promise.reject(new Error("no auth")), log: () => {} },
				{ declaresAuth: false },
			),
		);

	test("is checked by test(): a folder is ok, a missing path or a file fails naming it", async () => {
		const { music } = seed();
		expect(await check(music)).toEqual({ ok: true });
		for (const path of [join(music, "nope"), join(music, "Grace Hopper/Still Air.flac")]) {
			const result = await check(path);
			expect(result).toMatchObject({ ok: false, code: "misconfigured" });
			expect(result?.ok === false && result.message).toContain(path);
		}
	});
});
