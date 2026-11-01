import { describe, expect, test } from "bun:test";
import { validateSongDict } from "./index.ts";

const strobe = { title: "Strobe", artists: ["deadmau5"] };
const ghosts = { title: "Ghosts 'n' Stuff", artists: ["deadmau5", "Rob Swire"] };

function lenient(value: unknown) {
	const result = validateSongDict(value);
	if (!result.ok) throw new Error(`Expected a song dict, got ${JSON.stringify(result.issues)}`);
	return result;
}

describe("validateSongDict, lenient (ADR-0021)", () => {
	test("passes a clean song dict through with nothing reported", () => {
		const result = lenient({ playlists: [{ name: "Focus", songs: [strobe] }] });
		expect(result.songDict).toEqual({
			version: 1,
			playlists: [{ name: "Focus", id: {}, songs: [{ ...strobe, id: {} }] }],
		});
		expect(result.rejections).toEqual([]);
		expect(result.strippedKeys).toEqual([]);
	});

	test("drops a bad song and keeps the rest of its playlist", () => {
		const result = lenient({
			playlists: [{ name: "Focus", songs: [strobe, { title: "", artists: [] }, ghosts] }],
		});
		expect(result.songDict.playlists[0]?.songs.map((song) => song.title)).toEqual([
			"Strobe",
			"Ghosts 'n' Stuff",
		]);
		expect(result.rejections).toEqual([
			{
				playlist: 0,
				playlistName: "Focus",
				song: 1,
				issues: [{ path: ["playlists", 0, "songs", 1, "title"], message: expect.any(String) }],
			},
		]);
	});

	test("names the rejected song by its title where it has one", () => {
		const result = lenient({
			playlists: [{ name: "Focus", songs: [{ title: "Strobe", artists: "deadmau5" }] }],
		});
		expect(result.rejections[0]).toMatchObject({ song: 0, songTitle: "Strobe" });
	});

	test("drops a playlist that fails its own fields, with all its songs", () => {
		const result = lenient({
			playlists: [
				{ name: "  ", songs: [strobe] },
				{ name: "Focus", songs: [ghosts] },
			],
		});
		expect(result.songDict.playlists.map((playlist) => playlist.name)).toEqual(["Focus"]);
		expect(result.rejections).toEqual([
			{
				playlist: 0,
				issues: [{ path: ["playlists", 0, "name"], message: expect.any(String) }],
			},
		]);
	});

	test("drops a playlist whose songs are not a list", () => {
		const result = lenient({ playlists: [{ name: "Focus", songs: "Strobe" }] });
		expect(result.songDict.playlists).toEqual([]);
		expect(result.rejections).toEqual([
			{
				playlist: 0,
				playlistName: "Focus",
				issues: [{ path: ["playlists", 0, "songs"], message: expect.any(String) }],
			},
		]);
	});

	test.each([
		["a bare list", [{ name: "Focus", songs: [] }]],
		["no playlists", {}],
		["undefined", undefined],
		["a later version", { version: 2, playlists: [] }],
	])("fails %s as a whole", (_, value) => {
		const result = validateSongDict(value);
		expect(result.ok).toBe(false);
	});

	test("strips unknown keys and reports where they were", () => {
		const result = lenient({
			source: "v1",
			playlists: [{ name: "Focus", owner: "cal", songs: [{ ...strobe, duration: 337 }] }],
		});
		expect(result.songDict.playlists[0]?.songs[0]).not.toHaveProperty("duration");
		expect(result.strippedKeys).toEqual([
			["source"],
			["playlists", 0, "owner"],
			["playlists", 0, "songs", 0, "duration"],
		]);
		expect(result.rejections).toEqual([]);
	});
});

describe("validateSongDict, strict", () => {
	test("passes a clean song dict", () => {
		const result = validateSongDict(
			{ version: 1, playlists: [{ name: "Focus", songs: [strobe] }] },
			{ strict: true },
		);
		expect(result.ok).toBe(true);
	});

	test.each([
		["a bad song", { playlists: [{ name: "Focus", songs: [{ title: "", artists: [] }] }] }],
		["a bad playlist", { playlists: [{ name: "", songs: [] }] }],
		["a non-list return", { playlists: "Focus" }],
		["an unknown key", { playlists: [{ name: "Focus", songs: [{ ...strobe, duration: 337 }] }] }],
		["a repair", { playlists: [{ name: "Focus ", songs: [] }] }],
	])("fails on %s", (_, value) => {
		const result = validateSongDict(value, { strict: true });
		expect(result.ok).toBe(false);
		expect(result.ok ? [] : result.issues).not.toEqual([]);
	});
});
