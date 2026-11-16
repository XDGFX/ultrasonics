import { expect, test } from "bun:test";
import type { PlaylistInput, SongInput } from "@ultrasonics/plugin-sdk";
import { SongDict } from "@ultrasonics/plugin-sdk";
import playlistMerger from "./index.ts";
import { merge } from "./test-support.ts";

/** The merged-group log line, matched on its interpolated values in order. */
const mergedLine = (name: string, playlists: number, songsIn: number, dropped: number) =>
	expect.stringMatching(
		new RegExp(`"${name}"\\D*\\b${playlists}\\b\\D*\\b${songsIn}\\b\\D*\\b${dropped}\\b`),
	);

const strobe: SongInput = { title: "Strobe", artists: ["deadmau5"], durationMs: 637_000, id: {} };
const midnightCity: SongInput = {
	title: "Midnight City",
	artists: ["M83"],
	durationMs: 243_000,
	id: {},
};

test("playlists with no namesake pass through unchanged and in order", async () => {
	const input: PlaylistInput[] = [
		{ name: "Focus", id: { spotify: "f" }, songs: [strobe] },
		{ name: "Running", description: "Fast ones", id: {}, songs: [midnightCity] },
	];
	const { playlists, lines } = await merge(...input);
	expect(playlists).toEqual(SongDict.parse({ playlists: input }).playlists);
	expect(lines).toEqual([]);
});

const fluffingADuck: SongInput = {
	title: "Fluffing a Duck",
	artists: ["Kevin MacLeod"],
	isrc: "USUAN1100369",
	durationMs: 64_000,
	id: { spotify: "duck" },
};
const sneakySnitch: SongInput = {
	title: "Sneaky Snitch",
	artists: ["Kevin MacLeod"],
	durationMs: 136_000,
	id: {},
};

test("two namesakes become one at the first one's position: its songs, then the later one's new songs", async () => {
	const { playlists, lines } = await merge(
		{ name: "Gym", id: { spotify: "s" }, songs: [strobe, fluffingADuck] },
		{ name: "Focus", id: {}, songs: [midnightCity] },
		{
			name: "Gym",
			id: { deezer: "d" },
			songs: [sneakySnitch, { ...fluffingADuck, id: { deezer: "duck" }, durationMs: 65_000 }],
		},
	);
	expect(playlists.map((p) => p.name)).toEqual(["Gym", "Focus"]);
	expect(playlists[0]?.songs.map((s) => s.title)).toEqual([
		"Strobe",
		"Fluffing a Duck",
		"Sneaky Snitch",
	]);
	expect(playlists[0]?.songs[1]?.id).toEqual({ spotify: "duck" });
	expect(lines).toEqual([{ level: "info", message: mergedLine("Gym", 2, 4, 1) }]);
});

test("three namesakes differing in case and spacing merge in input order under the first one's name", async () => {
	const { playlists, lines } = await merge(
		{ name: "gym", id: {}, songs: [strobe] },
		{ name: "GYM ", id: {}, songs: [midnightCity] },
		{ name: " Gym", id: {}, songs: [sneakySnitch] },
	);
	expect(playlists.map((p) => p.name)).toEqual(["gym"]);
	expect(playlists[0]?.songs.map((s) => s.title)).toEqual([
		"Strobe",
		"Midnight City",
		"Sneaky Snitch",
	]);
	expect(lines).toEqual([{ level: "info", message: mergedLine("gym", 3, 3, 0) }]);
});

test.each<[string, SongInput, SongInput]>([
	[
		"a shared id",
		{ ...strobe, id: { spotify: "strobe" } },
		{ ...midnightCity, id: { spotify: "strobe" } },
	],
	[
		"a shared location",
		{ ...strobe, location: "file:///music/strobe.flac" },
		{ ...midnightCity, location: "file:///music/strobe.flac" },
	],
	[
		"a shared ISRC, whatever the title and artist",
		{ ...strobe, isrc: "CAB390900018" },
		{ ...midnightCity, isrc: "CAB390900018", durationMs: 640_000 },
	],
	["title, artist and length", strobe, { ...strobe, durationMs: 637_400 }],
])(
	"a later song that is a duplicate by %s is dropped, and the first playlist's copy kept",
	async (_, kept, dropped) => {
		const { playlists } = await merge(
			{ name: "Gym", id: {}, songs: [kept] },
			{ name: "Gym", id: {}, songs: [dropped, sneakySnitch] },
		);
		expect(playlists[0]?.songs).toEqual(
			SongDict.parse({ playlists: [{ name: "x", songs: [kept, sneakySnitch] }] }).playlists[0]
				?.songs ?? [],
		);
	},
);

test("a shared ISRC past the length veto is kept, since some ISRCs are wrong", async () => {
	const tagged = { ...strobe, isrc: "CAB390900018" };
	const stranger = { ...midnightCity, isrc: "CAB390900018" };
	const { playlists } = await merge(
		{ name: "Gym", id: {}, songs: [tagged] },
		{ name: "Gym", id: {}, songs: [stranger] },
	);
	expect(playlists[0]?.songs.map((s) => s.title)).toEqual(["Strobe", "Midnight City"]);
});

test("a remix of a song in the first playlist is kept", async () => {
	const remix = { ...strobe, title: "Strobe (Club Edit)", durationMs: 637_000 };
	const { playlists } = await merge(
		{ name: "Gym", id: {}, songs: [strobe] },
		{ name: "Gym", id: {}, songs: [remix] },
	);
	expect(playlists[0]?.songs.map((s) => s.title)).toEqual(["Strobe", "Strobe (Club Edit)"]);
});

test("a later playlist's own repeats are kept, while its duplicates of earlier songs are not", async () => {
	const { playlists } = await merge(
		{ name: "Gym", id: {}, songs: [strobe] },
		{ name: "Gym", id: {}, songs: [midnightCity, strobe, midnightCity] },
	);
	expect(playlists[0]?.songs.map((s) => s.title)).toEqual([
		"Strobe",
		"Midnight City",
		"Midnight City",
	]);
});

test("ids are unioned, and a conflicting id keeps the first value with a warning naming the key", async () => {
	const { playlists, lines } = await merge(
		{ name: "Gym", id: { spotify: "first" }, songs: [] },
		{ name: "Gym", id: { spotify: "second", deezer: "d" }, songs: [] },
		{ name: "Gym", id: { plex: "p" }, songs: [] },
	);
	expect(playlists[0]?.id).toEqual({ spotify: "first", deezer: "d", plex: "p" });
	const warnings = lines.filter((line) => line.level === "warn");
	expect(warnings).toEqual([{ level: "warn", message: expect.stringContaining("spotify") }]);
});

test("the description comes from the first playlist that has one", async () => {
	const { playlists } = await merge(
		{ name: "Gym", id: {}, songs: [] },
		{ name: "Gym", description: "Lifting", id: {}, songs: [] },
		{ name: "Gym", description: "Running", id: {}, songs: [] },
	);
	expect(playlists).toEqual([{ name: "Gym", description: "Lifting", id: {}, songs: [] }]);
});

test("a leftover setting, such as v1's fuzzy ratio, is stripped rather than refused", () => {
	expect(playlistMerger.instanceSettings.modifiers.parse({ fuzzy_ratio: "90" })).toEqual({});
});
