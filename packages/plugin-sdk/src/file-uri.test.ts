import { describe, expect, test } from "bun:test";
import { fromFileUri, Song, toFileUri } from "./index.ts";

// v1 #22: a Windows path must give the same URI on the Ubuntu CI runner as on Windows.
const pathsAndUris = [
	["/home/cal/Music/Strobe.flac", "file:///home/cal/Music/Strobe.flac"],
	["/home/cal/Music/a b#1 100%.flac", "file:///home/cal/Music/a%20b%231%20100%25.flac"],
	["/home/cal/Música/Björk.flac", "file:///home/cal/M%C3%BAsica/Bj%C3%B6rk.flac"],
	["C:\\Users\\Cal\\Music\\Strobe.flac", "file:///C:/Users/Cal/Music/Strobe.flac"],
	["C:\\Music\\a b#1 100%.flac", "file:///C:/Music/a%20b%231%20100%25.flac"],
	["C:\\Música\\Björk.flac", "file:///C:/M%C3%BAsica/Bj%C3%B6rk.flac"],
	["\\\\nas\\share\\Music\\a b#1 100%.flac", "file://nas/share/Music/a%20b%231%20100%25.flac"],
	["\\\\nas\\share\\Música\\Björk.flac", "file://nas/share/M%C3%BAsica/Bj%C3%B6rk.flac"],
] as const;

describe("toFileUri", () => {
	test.each(pathsAndUris)("encodes %p", (path, uri) => {
		expect(toFileUri(path)).toBe(uri);
	});

	test.each(pathsAndUris)("gives a song location for %p", (path) => {
		const song = Song.safeParse({
			title: "Strobe",
			artists: ["deadmau5"],
			location: toFileUri(path),
		});
		expect(song.success).toBe(true);
	});

	test("accepts forward slashes in a Windows drive path", () => {
		expect(toFileUri("D:/Music/a b.flac")).toBe("file:///D:/Music/a%20b.flac");
	});

	test.each([
		"",
		"Music/a.flac",
		"./a.flac",
		"../a.flac",
		"C:a.flac",
		"\\Music\\a.flac",
		"/",
		"\\\\nas",
		"\\\\nas\\",
	])("gives undefined for %p, which names no absolute file", (path) => {
		expect(toFileUri(path)).toBeUndefined();
	});
});

describe("fromFileUri", () => {
	test.each(pathsAndUris)("decodes to %p", (path, uri) => {
		expect(fromFileUri(uri)).toBe(path);
	});

	test.each([
		"",
		"not a uri",
		"/home/cal/Music/a.flac",
		"C:\\Music\\a.flac",
		"https://example.com/a.flac",
		"file:///home/cal/a%2Fb.flac",
		"file:///C:/Music/a%5Cb.flac",
	])("gives undefined for %p, which names no local path", (uri) => {
		expect(fromFileUri(uri)).toBeUndefined();
	});
});
