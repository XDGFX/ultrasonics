import { describe, expect, test } from "bun:test";
import {
	createRunContext,
	type LogEntry,
	type OutputResult,
	type Plugin,
	RunPayload,
	type SongDictInput,
	type SongInput,
} from "@ultrasonics/plugin-sdk";
import logTracks from "./index.ts";
import { SONG_LINE_CAP } from "./log-tracks.ts";

interface Run {
	result: OutputResult;
	lines: string[];
	levels: Set<LogEntry["level"]>;
}

/** Runs the `outputs` handler through the SDK harness, as the runner would. */
async function runOutput(songs: SongDictInput): Promise<Run> {
	const plugin: Plugin = logTracks;
	const logs: LogEntry[] = [];
	const payload = RunPayload.parse({
		component: "outputs",
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: "/nonexistent",
		persistent: {},
		instance: plugin.instanceSettings.outputs?.parse({}),
		songs,
	});
	const context = createRunContext(
		payload,
		{
			credentials: () => Promise.reject(new Error("log-tracks has no auth")),
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: false },
	);
	const result = await plugin.run.outputs?.(context);
	if (result === undefined) throw new Error("log-tracks has no outputs handler");
	return {
		result,
		lines: logs.map((entry) => entry.message),
		levels: new Set(logs.map((entry) => entry.level)),
	};
}

const titled = (count: number, prefix: string): SongInput[] =>
	Array.from({ length: count }, (_, index) => ({ title: `${prefix} ${index + 1}`, artists: [] }));

describe("logging each playlist", () => {
	test("logs a header, then one line per song with every field it carries", async () => {
		const { result, lines, levels } = await runOutput({
			playlists: [
				{
					name: "Road trip",
					songs: [
						{
							title: "Heroes",
							artists: ["David Bowie", "Brian Eno"],
							album: '"Heroes"',
							isrc: "GBAYE7700135",
							location: "file:///music/heroes.flac",
							id: { spotify: "7Jh1bpe76CNTCgdgAdBw4Z", deezer: "3135556" },
						},
						{ title: "Untitled", artists: [] },
					],
				},
			],
		});
		expect(lines).toEqual([
			'"Road trip": 2 songs',
			'1. David Bowie, Brian Eno - Heroes ["Heroes"] spotify:7Jh1bpe76CNTCgdgAdBw4Z deezer:3135556 isrc:GBAYE7700135 file:///music/heroes.flac',
			"2. Untitled",
		]);
		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
		expect([...levels]).toEqual(["info"]);
	});

	test("skips an empty playlist as empty, and logs nothing for it", async () => {
		const { result, lines } = await runOutput({
			playlists: [
				{ name: "Nothing yet", songs: [] },
				{ name: "One", songs: titled(1, "Song") },
			],
		});
		expect(lines).toEqual(['"One": 1 songs', "1. Song 1"]);
		expect(result.playlists).toEqual([
			{ status: "skipped", playlist: 0, code: "empty", message: expect.any(String) },
			{ status: "written", playlist: 1, unmatched: [] },
		]);
	});
});

describe("the song line cap", () => {
	test("stops song lines at the cap across playlists, then logs counts and what it left out", async () => {
		const firstCount = SONG_LINE_CAP - 2;
		const { result, lines } = await runOutput({
			playlists: [
				{ name: "First", songs: titled(firstCount, "First") },
				{ name: "Second", songs: titled(5, "Second") },
				{ name: "Third", songs: titled(4, "Third") },
			],
		});

		const secondHeader = lines.indexOf('"Second": 5 songs');
		expect(lines[0]).toBe(`"First": ${firstCount} songs`);
		expect(lines.slice(secondHeader)).toEqual([
			'"Second": 5 songs',
			"1. Second 1",
			"2. Second 2",
			'"Third": 4 songs',
			"7 song lines omitted",
		]);
		expect(lines.filter((line) => /^\d+\. /.test(line))).toHaveLength(SONG_LINE_CAP);
		expect(result.playlists).toEqual([
			{ status: "written", playlist: 0, unmatched: [] },
			{ status: "written", playlist: 1, unmatched: [] },
			{ status: "written", playlist: 2, unmatched: [] },
		]);
	});

	test("logs no omitted count when every song line fits", async () => {
		const { lines } = await runOutput({
			playlists: [{ name: "Exact", songs: titled(SONG_LINE_CAP, "Song") }],
		});
		expect(lines).toHaveLength(SONG_LINE_CAP + 1);
		expect(lines.at(-1)).toBe(`${SONG_LINE_CAP}. Song ${SONG_LINE_CAP}`);
	});
});
