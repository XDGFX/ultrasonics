import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SongDictInput, toFileUri } from "@ultrasonics/plugin-sdk";
import { mappingHint } from "./playlist-input.ts";
import { lines, readInputs } from "./test-support.ts";

const fixtures = join(import.meta.dir, "../test/fixtures");

let root: string | undefined;
afterEach(() => {
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

/** A temporary folder holding `music/` and `playlists/` from the fixtures. */
function seed(): { music: string; playlists: string } {
	root = mkdtempSync(join(tmpdir(), "ultrasonics-local-playlists-"));
	const music = join(root, "music");
	const playlists = join(root, "playlists");
	cpSync(join(fixtures, "music"), music, { recursive: true });
	cpSync(join(fixtures, "playlists"), playlists, { recursive: true });
	// Made here rather than committed, so no fixture's name depends on how git stores Unicode.
	cpSync(join(music, "untagged.mp3"), join(music, "Fête.mp3"));
	return { music, playlists };
}

const playlistNamed = (songs: SongDictInput, name: string) =>
	songs.playlists.find((playlist) => playlist.name === name);

describe("reading a playlist", () => {
	test("resolves relative entries against the playlist's folder and reads each file's tags", async () => {
		const { music, playlists } = seed();
		const { songs } = await readInputs({ dir: playlists, filter: "relative" });
		const quietRoom = {
			title: "Quiet Room",
			artists: ["Ada Lovelace"],
			album: "Silence Sessions",
			date: "2021-03-04",
			isrc: "GBAAA2100001",
			location: toFileUri(join(music, "tagged.mp3")),
			id: {},
		};
		expect(songs.playlists).toEqual([
			{
				name: "relative",
				id: {},
				songs: [
					quietRoom,
					{
						title: "Empty Hall",
						artists: ["Grace Hopper"],
						album: "Silence Sessions",
						date: "2020",
						durationMs: 328,
						location: toFileUri(join(music, "tagged.m4a")),
						id: {},
					},
					quietRoom,
					{
						title: "untagged",
						artists: [],
						location: toFileUri(join(music, "untagged.mp3")),
						id: {},
					},
				],
			},
		]);
	});

	test("skips missing files and web addresses with one summary per playlist", async () => {
		const { music, playlists } = seed();
		const { logs } = await readInputs({ dir: playlists, filter: "relative" });
		const warnings = lines(logs, "warn");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(join(music, "gone.mp3"));
		expect(warnings[0]).not.toContain(mappingHint);
	});

	test("reads relative entries a Windows player wrote, with backslashes and bare CR endings", async () => {
		const { music, playlists } = seed();
		writeFileSync(join(playlists, "player.m3u8"), "..\\music\\tagged.mp3\r..\\music\\untagged.mp3");
		const { songs } = await readInputs({ dir: playlists, filter: "player" });
		expect(playlistNamed(songs, "player")?.songs.map((song) => song.location)).toEqual([
			toFileUri(join(music, "tagged.mp3")),
			toFileUri(join(music, "untagged.mp3")),
		]);
	});

	test("decodes an .m3u that isn't UTF-8 as Windows-1252", async () => {
		const { music, playlists } = seed();
		const { songs } = await readInputs({ dir: playlists, filter: "latin-1" });
		expect(playlistNamed(songs, "latin-1")?.songs).toEqual([
			{ title: "Fête", artists: [], location: toFileUri(join(music, "Fête.mp3")), id: {} },
		]);
	});

	test("carries a file whose tags can't be read under its file name", async () => {
		const { music, playlists } = seed();
		// A RIFF header with nothing after it: the reader runs out of file.
		writeFileSync(join(music, "broken.wav"), "RIFF");
		writeFileSync(join(playlists, "broken.m3u8"), "../music/broken.wav\n");
		const { songs, logs } = await readInputs({ dir: playlists, filter: "broken" });
		expect(playlistNamed(songs, "broken")?.songs).toEqual([
			{ title: "broken", artists: [], location: toFileUri(join(music, "broken.wav")), id: {} },
		]);
		expect(lines(logs, "debug")).toHaveLength(1);
	});
});

describe("choosing playlist files", () => {
	test("reads .m3u and .m3u8 files at the top level in path order, skipping hidden files", async () => {
		const { playlists } = seed();
		const { songs } = await readInputs({ dir: playlists });
		expect(songs.playlists.map((playlist) => playlist.name)).toEqual([
			"latin-1",
			"relative",
			"windows",
		]);
	});

	test("reads subfolders when asked, with any case of extension", async () => {
		const { music, playlists } = seed();
		const { songs } = await readInputs({ dir: playlists, recursive: true });
		expect(songs.playlists.map((playlist) => playlist.name)).toEqual([
			"Classics",
			"latin-1",
			"relative",
			"windows",
		]);
		expect(playlistNamed(songs, "Classics")?.songs[0]?.location).toBe(
			toFileUri(join(music, "tagged.flac")),
		);
	});

	test("keeps only playlists whose whole name the filter matches", async () => {
		const { playlists } = seed();
		const filter = "REL*, latin-?, wind";
		const { songs, logs } = await readInputs({ dir: playlists, filter });
		expect(songs.playlists.map((playlist) => playlist.name)).toEqual(["latin-1", "relative"]);
		expect(lines(logs, "warn").filter((line) => line.includes(filter))).toEqual([]);
	});

	test("warns when the filter matches no playlist", async () => {
		const { playlists } = seed();
		const { songs, logs } = await readInputs({ dir: playlists, filter: "jazz*" });
		expect(songs.playlists).toEqual([]);
		expect(lines(logs, "warn")).toEqual([expect.stringContaining("jazz*")]);
	});

	test("skips a playlist file that can't be read and reads the rest", async () => {
		const { playlists } = seed();
		symlinkSync(join(playlists, "nowhere.m3u"), join(playlists, "dangling.m3u"));
		const { songs, logs } = await readInputs({ dir: playlists, filter: "dangling, relative" });
		expect(songs.playlists.map((playlist) => playlist.name)).toEqual(["relative"]);
		expect(lines(logs, "warn")).toContainEqual(
			expect.stringContaining(join(playlists, "dangling.m3u")),
		);
	});

	test("fails the run when the playlists folder doesn't exist, naming it", async () => {
		const { playlists } = seed();
		const missing = join(playlists, "not-here");
		await expect(readInputs({ dir: missing })).rejects.toThrow(missing);
	});
});

describe("the path mapping", () => {
	test("translates the player's paths, file URIs among them, into ultrasonics' own", async () => {
		const { music, playlists } = seed();
		const { songs, logs } = await readInputs(
			{ dir: playlists, filter: "windows" },
			{ playlistRoot: "D:\\Music", localRoot: music },
		);
		expect(playlistNamed(songs, "windows")?.songs).toEqual([
			{
				title: "Still Air",
				artists: ["Ada Lovelace"],
				album: "Silence Sessions",
				date: "2019-11",
				isrc: "USAAA1900002",
				durationMs: 200,
				location: toFileUri(join(music, "tagged.flac")),
				id: { musicbrainz: "8f3471b5-7e6a-48da-86a9-c1c07a0f47ae" },
			},
			expect.objectContaining({
				title: "Quiet Room",
				location: toFileUri(join(music, "tagged.mp3")),
			}),
		]);
		expect(lines(logs, "warn")).toEqual([]);
	});

	test("warns that the mapping is likely wrong when no entry of a playlist was found", async () => {
		const { playlists } = seed();
		const { songs, logs } = await readInputs(
			{ dir: playlists, filter: "windows" },
			{ playlistRoot: "E:/Music", localRoot: "/music" },
		);
		expect(playlistNamed(songs, "windows")?.songs).toEqual([]);
		expect(lines(logs, "warn")).toEqual([expect.stringContaining(mappingHint)]);
	});
});
