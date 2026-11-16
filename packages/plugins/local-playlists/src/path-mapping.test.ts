import { describe, expect, test } from "bun:test";
import { mapPath } from "./path-mapping.ts";

describe("mapPath", () => {
	test.each([
		["at the start", "/old/music/a/b.mp3", "/old/music", "/music", "/music/a/b.mp3"],
		["the root itself", "/old/music", "/old/music/", "/music/", "/music"],
		[
			"not mid-path",
			"/archive/old/music/b.mp3",
			"/old/music",
			"/music",
			"/archive/old/music/b.mp3",
		],
		["not inside a segment", "/old/musicals/b.mp3", "/old/music", "/music", "/old/musicals/b.mp3"],
		["Windows to POSIX", "D:\\Music\\A\\b.mp3", "D:/Music", "/music", "/music/A/b.mp3"],
		["a drive in any case", "d:/music/b.mp3", "D:\\Music\\", "/music", "/music/b.mp3"],
		["POSIX to Windows", "/music/A/b.mp3", "/music", "D:\\Music", "D:\\Music\\A\\b.mp3"],
		["Windows to Windows", "D:\\Music\\A/b.mp3", "D:\\Music", "E:\\Tunes", "E:\\Tunes\\A/b.mp3"],
		["not across shapes", "/D:/Music/b.mp3", "D:/Music", "/music", "/D:/Music/b.mp3"],
		["a UNC share", "\\\\nas\\music\\b.mp3", "\\\\nas\\music", "/music", "/music/b.mp3"],
	])("translates by whole leading segments: %s", (_, path, from, to, expected) => {
		expect(mapPath(path, from, to)).toBe(expected);
	});
});
