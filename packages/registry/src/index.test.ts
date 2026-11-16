import { expect, test } from "bun:test";
import { officialPlugins } from "./index.ts";

test("each entry loads the plugin registered under its name", async () => {
	for (const [name, entry] of Object.entries(officialPlugins)) {
		expect((await entry.load()).default.name).toBe(name);
	}
	expect(Object.keys(officialPlugins)).toEqual([
		"deezer",
		"local-music-database",
		"local-playlists",
		"log-tracks",
		"plex",
		"spotify",
	]);
});

test("each entry's path is a resolved file URL to the module its loader imports", async () => {
	for (const entry of Object.values(officialPlugins)) {
		expect(new URL(entry.path).protocol).toBe("file:");
		expect(await import(entry.path)).toBe(await entry.load());
	}
});
