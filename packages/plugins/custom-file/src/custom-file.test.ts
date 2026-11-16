import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createRunContext,
	type LogEntry,
	type OutputResult,
	type Plugin,
	RunPayload,
	type SongDictInput,
} from "@ultrasonics/plugin-sdk";
import { textExtensions } from "./file-name.ts";
import customFile from "./index.ts";

let dir: string | undefined;
afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = undefined;
});

function scratch(): string {
	dir = mkdtempSync(join(tmpdir(), "ultrasonics-custom-file-"));
	return dir;
}

interface Written {
	result: OutputResult;
	logs: LogEntry[];
}

/** Runs the `outputs` handler through the SDK harness, settings parsed as the runner parses them. */
async function write(
	instance: Record<string, unknown>,
	playlists: SongDictInput["playlists"],
): Promise<Written> {
	const plugin: Plugin = customFile;
	const logs: LogEntry[] = [];
	const payload = RunPayload.parse({
		component: "outputs",
		appletId: "applet",
		runId: "run",
		deadlineMs: Date.now() + 60_000,
		configDir: "/nonexistent",
		persistent: {},
		instance: plugin.instanceSettings.outputs?.parse(instance),
		songs: { version: 1, playlists },
	});
	const context = createRunContext(
		payload,
		{
			credentials: () => Promise.reject(new Error("custom-file has no auth")),
			log: (entry) => logs.push(entry),
		},
		{ declaresAuth: false },
	);
	const result = (await plugin.run.outputs?.(context)) as OutputResult;
	return { result, logs };
}

const read = (name: string) => readFileSync(join(dir ?? "", name), "utf8");

describe("writing lines", () => {
	test("writes one line per song from the pattern into a file named after the playlist", async () => {
		const folder = scratch();
		const { result } = await write({ dir: folder }, [
			{
				name: "Focus",
				songs: [
					{ title: "Strobe", artists: ["deadmau5"] },
					{ title: "Midnight City", artists: ["M83"] },
				],
			},
		]);

		expect(read("Focus.txt")).toBe("deadmau5 - Strobe\nM83 - Midnight City\n");
		expect(result).toEqual({ playlists: [{ status: "written", playlist: 0, unmatched: [] }] });
	});
});

describe("settings", () => {
	const issuesOf = (instance: Record<string, unknown>) => {
		const parsed = customFile.instanceSettings.outputs.safeParse({
			dir: "/playlists",
			...instance,
		});
		return parsed.success
			? []
			: parsed.error.issues.map(({ path, message }) => ({ path, message }));
	};

	test("defaults to {name}.txt, {artist} - {title} and overwrite", () => {
		expect(customFile.instanceSettings.outputs.parse({ dir: "/playlists" })).toEqual({
			dir: "/playlists",
			fileName: "{name}.txt",
			pattern: "{artist} - {title}",
			existing: "overwrite",
		});
	});

	test("rejects unknown placeholders in the pattern, naming each", () => {
		const issues = issuesOf({ pattern: "{artist} - {titel} {id.spotify} {durationMs}" });
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toEqual(["pattern"]);
		expect(issues[0]?.message).toContain("{titel}, {durationMs}");
	});

	test("accepts every placeholder and escaped braces", () => {
		expect(
			issuesOf({
				pattern: "{{{title}}} {artist} {artists} {album} {date} {isrc} {location} {id.plex:abc}",
			}),
		).toEqual([]);
	});

	test.each([
		["nothing", ""],
		["a stray {", "{artist - {title}"],
		["a stray }", "{artist} } {title}"],
	])("rejects %s in the pattern", (_, pattern) => {
		expect(issuesOf({ pattern }).map((issue) => issue.path)).toEqual([["pattern"]]);
	});

	test.each([
		["a /", "../{name}.txt"],
		["a \\", "sub\\{name}.txt"],
		["a placeholder other than {name}", "{title}.txt"],
		["v2's database file name", "ultrasonics.db"],
		["a key file's extension", "{name}.key"],
		["no extension", "{name}"],
	])("rejects a file name with %s", (_, fileName) => {
		const issues = issuesOf({ fileName });
		expect(issues.length).toBeGreaterThan(0);
		expect(issues.every((issue) => issue.path[0] === "fileName")).toBe(true);
	});

	test("names the placeholder a file name may not use", () => {
		expect(issuesOf({ fileName: "{name} {title}.txt" })[0]?.message).toContain("{title}");
	});

	test.each(textExtensions.map((extension) => [extension]))("accepts a %s file", (extension) => {
		expect(issuesOf({ fileName: `{name}${extension.toUpperCase()}` })).toEqual([]);
	});

	test("rejects a relative folder", () => {
		expect(issuesOf({ dir: "playlists" }).map((issue) => issue.path)).toEqual([["dir"]]);
	});
});

describe("rendering", () => {
	test("renders every placeholder, and {{ and }} as braces", async () => {
		const folder = scratch();
		await write(
			{
				dir: folder,
				pattern:
					"{{{title}}}|{artist}|{artists}|{album}|{date}|{isrc}|{location}|{id.spotify}|{id.plex:abc}",
			},
			[
				{
					name: "All",
					songs: [
						{
							title: "Strobe",
							artists: ["deadmau5", "Rob Swire"],
							album: "For Lack of a Better Name",
							date: "2009-09-22",
							isrc: "USUS10900001",
							location: "file:///music/Fa%C3%A7ade/strobe.mp3",
							id: { spotify: "3Ws9", "plex:abc": "42" },
						},
					],
				},
			],
		);

		expect(read("All.txt")).toBe(
			"{Strobe}|deadmau5|deadmau5, Rob Swire|For Lack of a Better Name|2009-09-22|USUS10900001|/music/Façade/strobe.mp3|3Ws9|42\n",
		);
	});

	test("writes backslashes, quotes and non-ASCII exactly, UTF-8 without a BOM, and line breaks as spaces", async () => {
		const folder = scratch();
		await write({ dir: folder, pattern: "{title}" }, [
			{
				name: "Exact",
				songs: [
					{ title: "AC\\DC \\1 $& “Quoted” ‘it’s’ Björk 東京", artists: [] },
					{ title: "Two\nlines\r\nhere\rend", artists: [] },
				],
			},
		]);

		const bytes = readFileSync(join(folder, "Exact.txt"));
		expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
		expect(bytes.toString("utf8")).toBe(
			"AC\\DC \\1 $& “Quoted” ‘it’s’ Björk 東京\nTwo lines here end\n",
		);
	});

	test("lists a song missing a field the pattern uses as unmatched, and writes the rest", async () => {
		const folder = scratch();
		const { result } = await write({ dir: folder, pattern: "{artist} - {title} ({isrc})" }, [
			{
				name: "Mixed",
				songs: [
					{ title: "No ISRC", artists: ["A"] },
					{ title: "Has one", artists: ["B"], isrc: "GBAYE0601498" },
					{ title: "No artist", artists: [], isrc: "GBAYE0601499" },
				],
			},
		]);

		expect(read("Mixed.txt")).toBe("B - Has one (GBAYE0601498)\n");
		expect(result.playlists).toEqual([{ status: "written", playlist: 0, unmatched: [0, 2] }]);
	});

	test("skips a playlist with no songs as empty, and one where no song renders as no-lines, with a warning", async () => {
		const folder = scratch();
		const { result, logs } = await write({ dir: folder, pattern: "{isrc}" }, [
			{ name: "Empty", songs: [] },
			{ name: "No ISRCs", songs: [{ title: "x", artists: [] }] },
		]);

		expect(result.playlists).toMatchObject([
			{ status: "skipped", playlist: 0, code: "empty" },
			{ status: "skipped", playlist: 1, code: "no-lines" },
		]);
		expect(logs.map((entry) => entry.level)).toEqual(["warn"]);
		expect(readdirSync(folder)).toEqual([]);
	});
});

describe("file names", () => {
	test("sanitises playlist names, and skips one left empty as invalid-name", async () => {
		const folder = scratch();
		const song = { title: "x", artists: ["y"] };
		const { result } = await write({ dir: folder }, [
			{ name: 'AC/DC: "Live" <at>\tRiver*Plate? | 1991. ', songs: [song] },
			{ name: "con", songs: [song] },
			{ name: "LPT1.backup", songs: [song] },
			{ name: '/:*?"<>|. ', songs: [song] },
		]);

		expect(readdirSync(folder).sort()).toEqual(
			["ACDC Live at RiverPlate 1991.txt", "_con.txt", "_LPT1.backup.txt"].sort(),
		);
		expect(result.playlists[3]).toMatchObject({ status: "skipped", code: "invalid-name" });
	});

	test("without {name}, writes every playlist into one file, in order", async () => {
		const folder = scratch();
		const { result } = await write({ dir: folder, fileName: "songs.txt", pattern: "{title}" }, [
			{ name: "One", songs: [{ title: "a", artists: [] }] },
			{ name: "Empty", songs: [] },
			{
				name: "Two",
				songs: [
					{ title: "b", artists: [] },
					{ title: "c", artists: [] },
				],
			},
		]);

		expect(readdirSync(folder)).toEqual(["songs.txt"]);
		expect(read("songs.txt")).toBe("a\nb\nc\n");
		expect(result.playlists.map((entry) => entry.status)).toEqual([
			"written",
			"skipped",
			"written",
		]);
	});

	test("writes names that differ only in case or Unicode form into one file, so neither replaces the other", async () => {
		const folder = scratch();
		const { result } = await write({ dir: folder, pattern: "{title}" }, [
			{ name: "Rock Café", songs: [{ title: "a", artists: [] }] },
			{ name: "rock café", songs: [{ title: "b", artists: [] }] },
		]);

		expect(readdirSync(folder)).toEqual(["Rock Café.txt"]);
		expect(read("Rock Café.txt")).toBe("a\nb\n");
		expect(result.playlists.map((entry) => entry.status)).toEqual(["written", "written"]);
	});
});

describe("existing files", () => {
	const playlist = (title: string) => [{ name: "List", songs: [{ title, artists: [] }] }];

	test("overwrite replaces the file and leaves no temporary file behind", async () => {
		const folder = scratch();
		writeFileSync(join(folder, "List.txt"), "old\nlines\n");

		await write({ dir: folder, pattern: "{title}" }, playlist("new"));

		expect(readdirSync(folder)).toEqual(["List.txt"]);
		expect(read("List.txt")).toBe("new\n");
	});

	test("append starts on a new line when the file lacks a final newline", async () => {
		const folder = scratch();
		writeFileSync(join(folder, "List.txt"), "old");

		await write({ dir: folder, pattern: "{title}", existing: "append" }, playlist("new"));
		await write({ dir: folder, pattern: "{title}", existing: "append" }, playlist("newer"));

		expect(read("List.txt")).toBe("old\nnew\nnewer\n");
	});

	test("append creates a missing file", async () => {
		const folder = scratch();
		await write({ dir: folder, pattern: "{title}", existing: "append" }, playlist("first"));
		expect(read("List.txt")).toBe("first\n");
	});
});

describe("failures", () => {
	test("a file that can't be written fails every playlist in it, while other files are written", async () => {
		const folder = scratch();
		writeFileSync(join(folder, "Locked.txt"), "kept\n");
		chmodSync(join(folder, "Locked.txt"), 0o444);
		mkdirSync(join(folder, "Taken.txt", "inside"), { recursive: true });
		const song = { title: "x", artists: [] };

		const { result } = await write({ dir: folder, fileName: "{name}.txt", pattern: "{title}" }, [
			{ name: "Locked", songs: [song] },
			{ name: "Open", songs: [song] },
			{ name: "Locked", songs: [song] },
			{ name: "Taken", songs: [song] },
		]);

		expect(result.playlists).toMatchObject([
			{ status: "failed", playlist: 0, code: "write-error" },
			{ status: "written", playlist: 1 },
			{ status: "failed", playlist: 2, code: "write-error" },
			{ status: "failed", playlist: 3, code: "write-error" },
		]);
		expect(read("Locked.txt")).toBe("kept\n");
		expect(read("Open.txt")).toBe("x\n");
		expect(readdirSync(folder).sort()).toEqual(["Locked.txt", "Open.txt", "Taken.txt"]);
	});

	test("a missing folder throws before anything is written", async () => {
		const folder = scratch();
		await expect(
			write({ dir: join(folder, "missing") }, [
				{ name: "A", songs: [{ title: "x", artists: ["y"] }] },
			]),
		).rejects.toThrow(join(folder, "missing"));
	});
});
