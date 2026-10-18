import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	Playlist,
	type PlaylistInput,
	type Playlist as PlaylistType,
	Song,
	SongDict,
	type SongDictInput,
	type SongDict as SongDictType,
	type SongInput,
	type Song as SongType,
	StrictSongDict,
} from "./song-dict.ts";

function issuePaths(result: z.ZodSafeParseResult<unknown>): PropertyKey[][] {
	return result.success ? [] : result.error.issues.map((issue) => issue.path);
}

function parsed<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
	const result = schema.safeParse(input);
	if (!result.success) throw new Error(z.prettifyError(result.error));
	return result.data;
}

const minimalSong = { title: "Strobe", artists: ["deadmau5"] };

describe("Song", () => {
	test("accepts a title and artists", () => {
		expect(Song.safeParse(minimalSong).success).toBe(true);
	});

	test.each([
		["missing", {}],
		["empty", { title: "" }],
		["whitespace", { title: "   " }],
		["null", { title: null }],
	])("rejects a %s title (v1 #38)", (_, title) => {
		const { title: _drop, ...rest } = minimalSong;
		expect(issuePaths(Song.safeParse({ ...rest, ...title }))).toEqual([["title"]]);
	});

	test("trims the title", () => {
		expect(parsed(Song, { ...minimalSong, title: "  Strobe \n" }).title).toBe("Strobe");
	});

	test("accepts an untagged song with no artists", () => {
		expect(parsed(Song, { ...minimalSong, artists: [] }).artists).toEqual([]);
	});

	test.each([null, "", "  \t"])("treats an album of %p as absent", (album) => {
		expect(parsed(Song, { ...minimalSong, album })).not.toHaveProperty("album");
	});

	test("trims the album", () => {
		expect(parsed(Song, { ...minimalSong, album: " For Lack of a Better Name " }).album).toBe(
			"For Lack of a Better Name",
		);
	});

	test.each(["2018", "2016-05", "2016-05-27", "2020-02-29"])("accepts the date %p", (date) => {
		expect(parsed(Song, { ...minimalSong, date }).date).toBe(date);
	});

	test.each([
		"2016-5-27",
		"2020-13",
		"2021-02-30",
		"2019-02-29",
		"27/05/2016",
		"2016-05-27T00:00:00Z",
	])("rejects the date %p", (date) => {
		expect(issuePaths(Song.safeParse({ ...minimalSong, date }))).toEqual([["date"]]);
	});

	test("accepts a normalised ISRC", () => {
		expect(parsed(Song, { ...minimalSong, isrc: "GBAYE0601498" }).isrc).toBe("GBAYE0601498");
	});

	test.each(["gbaye0601498", "GB-AYE-06-01498", "GBAYE060149", "GBAYE06014981", "G1AYE0601498"])(
		"rejects the ISRC %p",
		(isrc) => {
			expect(issuePaths(Song.safeParse({ ...minimalSong, isrc }))).toEqual([["isrc"]]);
		},
	);

	test.each([
		"file:///home/cal/Music/a%20b.flac",
		"file:///C:/Music/a.flac",
		"file://nas/share/a.flac",
	])("accepts the location %p", (location) => {
		expect(parsed(Song, { ...minimalSong, location }).location).toBe(location);
	});

	test.each(["/home/cal/Music/a.flac", "C:\\Music\\a.flac", "https://example.com/a.flac", "file:"])(
		"rejects the location %p",
		(location) => {
			expect(issuePaths(Song.safeParse({ ...minimalSong, location }))).toEqual([["location"]]);
		},
	);

	test("accepts a duration in whole milliseconds", () => {
		expect(parsed(Song, { ...minimalSong, durationMs: 633_000 }).durationMs).toBe(633_000);
	});

	test.each([0, -1, 633.5, "633000"])("rejects the duration %p", (durationMs) => {
		expect(issuePaths(Song.safeParse({ ...minimalSong, durationMs }))).toEqual([["durationMs"]]);
	});

	test.each([true, false])("keeps explicit: %p", (explicit) => {
		expect(parsed(Song, { ...minimalSong, explicit }).explicit).toBe(explicit);
	});

	test.each([
		["durationMs", null],
		["explicit", null],
	])("treats a null %s as absent", (field, value) => {
		expect(parsed(Song, { ...minimalSong, [field]: value })).not.toHaveProperty(field);
	});

	test.each([undefined, null])("defaults an id of %p to an empty map", (id) => {
		expect(parsed(Song, { ...minimalSong, id }).id).toEqual({});
	});

	test("keeps IDs keyed by ID space, trimmed", () => {
		const id = {
			spotify: " 0VjIjW4GlUZAMYd2vXMi3b ",
			"plex:9f3c2a": "4821",
			musicbrainz: "b1a9c0e9",
		};
		expect(parsed(Song, { ...minimalSong, id }).id).toEqual({
			spotify: "0VjIjW4GlUZAMYd2vXMi3b",
			"plex:9f3c2a": "4821",
			musicbrainz: "b1a9c0e9",
		});
	});

	test.each(["Spotify", "plex:", "plex: 9f3c", "", "deezer track"])(
		"rejects the ID-space key %p",
		(key) => {
			const result = Song.safeParse({ ...minimalSong, id: { [key]: "1" } });
			expect(issuePaths(result)).toEqual([["id", key]]);
		},
	);

	test("drops blank and null IDs, as Last.fm's empty MBIDs need", () => {
		const id = { spotify: "0VjIjW4GlUZAMYd2vXMi3b", musicbrainz: " ", lastfm: null };
		expect(parsed(Song, { ...minimalSong, id }).id).toEqual({ spotify: "0VjIjW4GlUZAMYd2vXMi3b" });
	});

	test("rejects a blank artist name", () => {
		expect(issuePaths(Song.safeParse({ ...minimalSong, artists: ["deadmau5", " "] }))).toEqual([
			["artists", 1],
		]);
	});
});

describe("Playlist", () => {
	const minimalPlaylist = { name: "Focus", songs: [] };

	test("accepts a named playlist with no songs, defaulting its id", () => {
		expect(parsed(Playlist, minimalPlaylist)).toEqual({ name: "Focus", id: {}, songs: [] });
	});

	test.each([{}, { name: "" }, { name: " " }, { name: null }])("rejects the name in %p", (name) => {
		const result = Playlist.safeParse({ songs: [], ...name });
		expect(issuePaths(result)).toEqual([["name"]]);
	});

	test("rejects a playlist with no songs list", () => {
		expect(issuePaths(Playlist.safeParse({ name: "Focus" }))).toEqual([["songs"]]);
	});

	test.each([null, "", " "])("treats a description of %p as absent", (description) => {
		expect(parsed(Playlist, { ...minimalPlaylist, description })).not.toHaveProperty("description");
	});

	test("trims the description", () => {
		const description = " Deep work \n";
		expect(parsed(Playlist, { ...minimalPlaylist, description }).description).toBe("Deep work");
	});

	test("parses its songs", () => {
		const songs = [{ title: " Strobe ", artists: ["deadmau5"], album: "" }];
		expect(parsed(Playlist, { ...minimalPlaylist, songs }).songs).toEqual([
			{ title: "Strobe", artists: ["deadmau5"], id: {} },
		]);
	});
});

describe("SongDict", () => {
	test("defaults the version to 1", () => {
		expect(parsed(SongDict, { playlists: [] })).toEqual({ version: 1, playlists: [] });
	});

	test("rejects another version", () => {
		expect(issuePaths(SongDict.safeParse({ version: 2, playlists: [] }))).toEqual([["version"]]);
	});

	test("rejects a bare list of playlists", () => {
		expect(SongDict.safeParse([]).success).toBe(false);
	});

	test("strips unknown keys at every level", () => {
		const dict = {
			runId: "x",
			playlists: [
				{
					name: "Focus",
					owner: "cal",
					songs: [{ title: "Strobe", artists: ["deadmau5"], tracknumber: 3 }],
				},
			],
		};
		expect(parsed(SongDict, dict)).toEqual({
			version: 1,
			playlists: [
				{ name: "Focus", id: {}, songs: [{ title: "Strobe", artists: ["deadmau5"], id: {} }] },
			],
		});
	});
});

describe("StrictSongDict", () => {
	const cleanDict = {
		version: 1 as const,
		playlists: [
			{
				name: "Focus",
				description: "Deep work",
				id: { spotify: "37i9dQZF1DWZeKCadgRdKQ" },
				songs: [
					{
						title: "Strobe",
						artists: ["deadmau5"],
						album: "For Lack of a Better Name",
						date: "2009-09-22",
						isrc: "USUS10900456",
						durationMs: 633_000,
						explicit: false,
						location: "file:///home/cal/Music/Strobe.flac",
						id: { spotify: "0VjIjW4GlUZAMYd2vXMi3b" },
					},
				],
			},
		],
	};

	test("accepts a clean dict unchanged", () => {
		expect(parsed(StrictSongDict, cleanDict)).toEqual(cleanDict);
	});

	test("still applies the version and id defaults", () => {
		const dict = { playlists: [{ name: "Focus", songs: [{ title: "Strobe", artists: [] }] }] };
		expect(parsed(StrictSongDict, dict)).toEqual({
			version: 1,
			playlists: [{ name: "Focus", id: {}, songs: [{ title: "Strobe", artists: [], id: {} }] }],
		});
	});

	test("rejects every blank and untrimmed value that SongDict would repair", () => {
		const dict = {
			playlists: [
				{
					name: "Focus ",
					description: "",
					songs: [
						{
							title: "Strobe",
							artists: [" deadmau5"],
							album: null,
							isrc: "  ",
							id: { spotify: "0VjIjW4GlUZAMYd2vXMi3b\n" },
						},
					],
				},
			],
		};
		expect(SongDict.safeParse(dict).success).toBe(true);
		const song = ["playlists", 0, "songs", 0];
		expect(issuePaths(StrictSongDict.safeParse(dict))).toEqual([
			["playlists", 0, "name"],
			["playlists", 0, "description"],
			[...song, "artists", 0],
			[...song, "album"],
			[...song, "isrc"],
			[...song, "id", "spotify"],
		]);
	});

	test.each([
		["the dict", { playlists: [], runId: "x" }, []],
		["a playlist", { playlists: [{ name: "Focus", songs: [], owner: "cal" }] }, ["playlists", 0]],
		[
			"a song",
			{ playlists: [{ name: "Focus", songs: [{ title: "Strobe", artists: [], tracknumber: 3 }] }] },
			["playlists", 0, "songs", 0],
		],
	])("rejects an unknown key on %s", (_, dict, path) => {
		const result = StrictSongDict.safeParse(dict);
		expect(result.success ? [] : result.error.issues.map(({ code, path }) => [code, path])).toEqual(
			[["unrecognized_keys", path]],
		);
	});
});

/** True when `T` is `any` or `unknown`, which would leave a field untyped. */
type Untyped<T> = unknown extends T ? true : false;
type UntypedFields<T> = { [K in keyof T]-?: Untyped<T[K]> }[keyof T];

describe("the exported types", () => {
	test("type every field (checked by tsc)", () => {
		const fieldChecks: false[] = [
			false satisfies UntypedFields<SongInput>,
			false satisfies UntypedFields<SongType>,
			false satisfies UntypedFields<PlaylistInput>,
			false satisfies UntypedFields<PlaylistType>,
			false satisfies UntypedFields<SongDictInput>,
			false satisfies UntypedFields<SongDictType>,
		];
		expect(fieldChecks).not.toContain(true);
	});

	test("let a plugin return blanks and leave out defaults (checked by tsc)", () => {
		const song: SongInput = {
			title: "Strobe",
			artists: [],
			album: null,
			isrc: "",
			durationMs: null,
			explicit: null,
			id: null,
		};
		const dict: SongDictInput = {
			playlists: [{ name: "Focus", description: null, songs: [song] }],
		};
		expect(SongDict.safeParse(dict).success).toBe(true);
	});

	test("give the next plugin no blanks (checked by tsc)", () => {
		const song: SongType = { title: "Strobe", artists: [], id: {} };
		// @ts-expect-error a parsed song has no null fields
		song.album = null;
		// @ts-expect-error a parsed song has no null durations
		song.durationMs = null;
		// @ts-expect-error a parsed dict is always version 1
		const dict: SongDictType = { version: 2, playlists: [] };
		expect(dict).toBeDefined();
	});
});

describe("service fixtures", () => {
	const fixtures = new Bun.Glob("*.json").scanSync({
		cwd: `${import.meta.dir}/../test/fixtures/song-dict`,
		absolute: true,
	});

	test.each([...fixtures])(
		"SongDict repairs everything StrictSongDict rejects in %s",
		async (path) => {
			const clean = parsed(SongDict, await Bun.file(path).json());
			expect(parsed(StrictSongDict, clean)).toEqual(clean);
		},
	);
});
