import { expect, test } from "bun:test";
import { officialPlugins } from "./index.ts";

test("each entry loads the plugin registered under its name", async () => {
	for (const [name, entry] of Object.entries(officialPlugins)) {
		expect((await entry.load()).default.name).toBe(name);
	}
	expect(Object.keys(officialPlugins)).toEqual(["deezer", "plex", "spotify"]);
});
