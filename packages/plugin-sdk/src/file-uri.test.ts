import { describe, expect, test } from "bun:test";
import cases from "../test/fixtures/file-uri/paths.json";
import { fromFileUri, Song, toFileUri } from "./index.ts";

// v1 #22: a Windows path must give the same URI on the Ubuntu CI runner as on Windows.
const { pathsAndUris, forwardSlashDrivePaths, notAbsolutePaths, notLocalUris } = cases;

describe("toFileUri", () => {
	test.each(pathsAndUris)("encodes %p", (path, uri) => {
		expect(toFileUri(path)).toBe(uri);
	});

	test.each(forwardSlashDrivePaths)("accepts forward slashes in drive path %p", (path, uri) => {
		expect(toFileUri(path)).toBe(uri);
	});

	test.each([...pathsAndUris, ...forwardSlashDrivePaths])(
		"gives a song location for %p",
		(path) => {
			const location = toFileUri(path);
			const song = Song.parse({ title: "Strobe", artists: ["deadmau5"], location });
			expect(song).toHaveProperty("location", location);
		},
	);

	test.each(notAbsolutePaths)("gives undefined for %p, which names no absolute file", (path) => {
		expect(toFileUri(path)).toBeUndefined();
	});
});

describe("fromFileUri", () => {
	test.each(pathsAndUris)("decodes to %p", (path, uri) => {
		expect(fromFileUri(uri)).toBe(path);
	});

	test.each(notLocalUris)("gives undefined for %p, which names no local path", (uri) => {
		expect(fromFileUri(uri)).toBeUndefined();
	});
});
