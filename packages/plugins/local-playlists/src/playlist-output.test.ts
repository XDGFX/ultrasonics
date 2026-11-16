import { afterEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SongDictInput, toFileUri } from "@ultrasonics/plugin-sdk";
import { lines, readInputs, writeOutputs } from "./test-support.ts";

let root: string | undefined;
afterEach(() => {
	setSystemTime();
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

/** A temporary root holding an empty `playlists/` and `config/`. */
function folders(): { playlists: string; configDir: string } {
	root = mkdtempSync(join(tmpdir(), "ultrasonics-local-playlists-output-"));
	const playlists = join(root, "playlists");
	const configDir = join(root, "config");
	mkdirSync(playlists);
	mkdirSync(configDir);
	return { playlists, configDir };
}

const songs = (...playlists: SongDictInput["playlists"]): SongDictInput => ({
	version: 1,
	playlists,
});

describe("writing a playlist", () => {
	test("writes an extended M3U of the songs with a location, mapped back to the player's paths", async () => {
		const { playlists, configDir } = folders();
		const { result } = await writeOutputs(
			songs({
				name: "Evening",
				songs: [
					{
						title: "Quiet Room",
						artists: ["Ada", "Bo"],
						durationMs: 205_400,
						location: "file:///music/Ada/Quiet%20Room.mp3",
					},
					{ title: "Streamed", artists: ["Cy"] },
					{ title: "Untagged", artists: [], location: "file:///elsewhere/untagged.mp3" },
				],
			}),
			{
				instance: { dir: playlists },
				persistent: { playlistRoot: "D:\\Music", localRoot: "/music" },
				configDir,
			},
		);

		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [1] }] });
		expect(readFileSync(join(playlists, "Evening.m3u8"), "utf8")).toBe(
			[
				"#EXTM3U",
				"#EXTINF:205,Ada, Bo - Quiet Room",
				"D:\\Music\\Ada\\Quiet Room.mp3",
				"#EXTINF:-1,Untagged",
				"/elsewhere/untagged.mp3",
				"",
			].join("\n"),
		);
		expect(readdirSync(playlists)).toEqual(["Evening.m3u8"]);
	});
});

/** A playlist of one song with a location, so it is written. */
const located = (name: string, file = "/music/a.mp3") => ({
	name,
	songs: [{ title: "A", artists: ["Ada"], location: toFileUri(file) }],
});

describe("naming the file", () => {
	test("sanitises names so nothing derived from one leaves the folder or loses its extension", async () => {
		const { playlists, configDir } = folders();
		const names = [
			"AC/DC: Best Of",
			"CON",
			"com1.backup",
			"Trailing...",
			"Mix 🎧",
			"../../etc/passwd",
			'<>:"|?*',
		];
		const { result } = await writeOutputs(songs(...names.map((name) => located(name))), {
			instance: { dir: playlists },
			configDir,
		});

		expect(readdirSync(playlists).sort()).toEqual(
			[
				"ACDC Best Of.m3u8",
				"_CON.m3u8",
				"_com1.backup.m3u8",
				"Trailing.m3u8",
				"Mix 🎧.m3u8",
				"etcpasswd.m3u8",
			].sort(),
		);
		expect(result.playlists[6]).toMatchObject({ status: "skipped", code: "invalid-name" });
		expect(readdirSync(root ?? "").sort()).toEqual(["config", "playlists"]);
	});

	test("skips a second playlist that sanitises to the same file, ignoring case", async () => {
		const { playlists, configDir } = folders();
		const { result } = await writeOutputs(
			songs(located("Rock"), located("rock"), located("Ro/ck"), located("Pop")),
			{ instance: { dir: playlists }, configDir },
		);

		expect(result.playlists.map((entry) => [entry.status, "code" in entry && entry.code])).toEqual([
			["written", false],
			["skipped", "duplicate-name"],
			["skipped", "duplicate-name"],
			["written", false],
		]);
	});
});

describe("what is written", () => {
	test("skips an empty playlist and one with no locations, writing nothing for either", async () => {
		const { playlists, configDir } = folders();
		const { result, logs } = await writeOutputs(
			songs(
				{ name: "Empty", songs: [] },
				{ name: "Streamed", songs: [{ title: "S", artists: [] }] },
			),
			{ instance: { dir: playlists }, configDir },
		);

		expect(result.playlists).toEqual([
			{ status: "skipped", playlist: 0, code: "empty", message: expect.any(String) },
			{ status: "skipped", playlist: 1, code: "no-locations", message: expect.any(String) },
		]);
		expect(lines(logs, "warn")).toEqual([expect.stringContaining("Streamed")]);
		expect(readdirSync(playlists)).toEqual([]);
	});

	test("rewrites an existing .m3u in place and backs up only that file", async () => {
		const { playlists, configDir } = folders();
		writeFileSync(join(playlists, "Evening.m3u"), "/music/old.mp3\n");
		writeFileSync(join(playlists, "Untouched.m3u8"), "/music/b.mp3\n");
		setSystemTime(new Date("2026-11-16T02:48:52.000Z"));

		await writeOutputs(songs(located("Evening")), {
			instance: { dir: playlists },
			configDir,
			appletId: "a1",
		});

		expect(readdirSync(playlists).sort()).toEqual(["Evening.m3u", "Untouched.m3u8"]);
		expect(readFileSync(join(playlists, "Evening.m3u"), "utf8")).toContain("/music/a.mp3");
		const run = join(configDir, "backups", "a1", "2026-11-16T02-48-52.000Z");
		expect(readdirSync(run)).toEqual(["Evening.m3u"]);
		expect(readFileSync(join(run, "Evening.m3u"), "utf8")).toBe("/music/old.mp3\n");
	});

	test("keeps the newest runs' backups up to the setting, and none at 0", async () => {
		const { playlists, configDir } = folders();
		writeFileSync(join(playlists, "Evening.m3u8"), "/music/old.mp3\n");
		const days = ["01", "02", "03", "04"];
		for (const day of days) {
			setSystemTime(new Date(`2026-11-${day}T00:00:00.000Z`));
			await writeOutputs(songs(located("Evening")), {
				instance: { dir: playlists, backups: "3" },
				configDir,
				appletId: "a1",
			});
		}
		expect(readdirSync(join(configDir, "backups", "a1")).sort()).toEqual(
			days.slice(1).map((day) => `2026-11-${day}T00-00-00.000Z`),
		);

		await writeOutputs(songs(located("Evening")), {
			instance: { dir: playlists, backups: "0" },
			configDir,
			appletId: "a1",
		});
		expect(readdirSync(join(configDir, "backups", "a1"))).toEqual([]);
	});
});

describe("when writing fails", () => {
	test("reports a playlist it can't write as failed, and writes the next", async () => {
		const { playlists, configDir } = folders();
		mkdirSync(join(playlists, "Blocked.m3u8", "inside"), { recursive: true });

		const { result } = await writeOutputs(songs(located("Blocked"), located("Fine")), {
			instance: { dir: playlists },
			configDir,
		});

		expect(result.playlists).toEqual([
			{ status: "failed", playlist: 0, code: "write-error", message: expect.any(String) },
			{ status: "written", playlist: 1, unmatched: [] },
		]);
	});

	test("an interrupted write leaves the old file and no temporary one", async () => {
		const { playlists, configDir } = folders();
		writeFileSync(join(playlists, "Evening.m3u8"), "/music/old.mp3\n");
		const rename = spyOn(fs, "rename").mockRejectedValue(
			Object.assign(new Error("interrupted"), { code: "EIO" }),
		);
		try {
			const { result } = await writeOutputs(songs(located("Evening")), {
				instance: { dir: playlists },
				configDir,
			});
			expect(result.playlists[0]).toMatchObject({
				status: "failed",
				code: "write-error",
				message: expect.stringContaining("EIO"),
			});
		} finally {
			rename.mockRestore();
		}
		expect(readdirSync(playlists)).toEqual(["Evening.m3u8"]);
		expect(readFileSync(join(playlists, "Evening.m3u8"), "utf8")).toBe("/music/old.mp3\n");
	});

	test("a missing folder throws before any file is touched", async () => {
		const { playlists, configDir } = folders();
		const missing = join(playlists, "nope");

		await expect(
			writeOutputs(songs(located("Evening")), { instance: { dir: missing }, configDir }),
		).rejects.toThrow(missing);
		expect(readdirSync(configDir)).toEqual([]);
	});
});

test("a written playlist reads back through the input with the same songs", async () => {
	const { playlists, configDir } = folders();
	const music = join(root ?? "", "music");
	cpSync(join(import.meta.dir, "../test/fixtures/music"), music, { recursive: true });
	const mapping = { playlistRoot: "D:\\Music", localRoot: music };
	const files = ["tagged.mp3", "untagged.mp3"].map((file) => join(music, file));
	const written = files.map((file) => ({ title: "T", artists: [], location: toFileUri(file) }));
	await writeOutputs(songs({ name: "Round trip", songs: written }), {
		instance: { dir: playlists },
		persistent: mapping,
		configDir,
	});

	const { songs: read } = await readInputs({ dir: playlists }, mapping);
	expect(read.playlists.map((playlist) => playlist.name)).toEqual(["Round trip"]);
	expect(read.playlists[0]?.songs.map((song) => song.location)).toEqual(files.map(toFileUri));
	expect(readFileSync(join(playlists, "Round trip.m3u8"), "utf8")).toContain(
		"D:\\Music\\tagged.mp3",
	);
});
