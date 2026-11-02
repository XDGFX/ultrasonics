import { describe, expect, test } from "bun:test";
import { type IssuePath, outputResultIssues, SongDict } from "./index.ts";

const songs = SongDict.parse({
	playlists: [
		{
			name: "Focus",
			songs: [
				{ title: "Strobe", artists: ["deadmau5"] },
				{ title: "Ghosts", artists: ["deadmau5"] },
			],
		},
		{ name: "Running", songs: [{ title: "Sandstorm", artists: ["Darude"] }] },
	],
});

const written = (playlist: number, unmatched: number[] = []) => ({
	status: "written",
	playlist,
	unmatched,
});
const skipped = (playlist: number) => ({ status: "skipped", playlist, code: "empty", message: "" });

describe("outputResultIssues (ADR-0020 §2)", () => {
	test.each<[string, unknown, IssuePath[]]>([
		["a complete result", { playlists: [written(0, [1]), skipped(1)] }, []],
		["a result in any order", { playlists: [skipped(1), written(0)] }, []],
		[
			"not an output result",
			{ playlists: [{ status: "written", playlist: 0 }] },
			[["playlists", 0, "unmatched"]],
		],
		[
			"a playlist out of range",
			{ playlists: [written(0), written(1), written(2)] },
			[["playlists", 2, "playlist"]],
		],
		[
			"a negative playlist",
			{ playlists: [written(0), written(1), written(-1)] },
			[["playlists", 2, "playlist"]],
		],
		[
			"a repeated playlist",
			{ playlists: [written(0), skipped(1), written(0)] },
			[["playlists", 2, "playlist"]],
		],
		["a missing playlist", { playlists: [written(1)] }, [["playlists"]]],
		[
			"an unmatched song out of range",
			{ playlists: [written(0), written(1, [1])] },
			[["playlists", 1, "unmatched", 0]],
		],
		[
			"a negative unmatched song",
			{ playlists: [written(0, [-1]), written(1)] },
			[["playlists", 0, "unmatched", 0]],
		],
		[
			"a repeated unmatched song",
			{ playlists: [written(0, [0, 0]), written(1)] },
			[["playlists", 0, "unmatched", 1]],
		],
	])("%s", (_, result, paths) => {
		const issues = outputResultIssues(result, songs);
		expect(issues.map((issue) => issue.path)).toEqual(paths);
		for (const issue of issues) expect(issue.message).not.toBe("");
	});

	test("names each missing playlist once", () => {
		const issues = outputResultIssues({ playlists: [] }, songs);
		expect(issues).toEqual([
			{ path: ["playlists"], message: expect.stringMatching(/\b0\b/) },
			{ path: ["playlists"], message: expect.stringMatching(/\b1\b/) },
		]);
	});
});
