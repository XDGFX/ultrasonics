import { afterAll } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import localMusicDatabase from "./index.ts";

// The conformance suite reads its fixtures when registered, so the folder exists before any test.
const music = mkdtempSync(join(tmpdir(), "ultrasonics-local-music-database-conformance-"));
afterAll(() => rmSync(music, { recursive: true, force: true }));
cpSync(join(import.meta.dir, "../test/fixtures/music"), music, { recursive: true });

runConformance(localMusicDatabase, {
	persistentSettings: {
		valid: [{ musicDir: music }, { musicDir: "/music" }],
		invalid: [{}, { musicDir: "" }, { musicDir: "music" }, { musicDir: 42 }],
	},
	instanceSettings: {
		modifiers: { valid: [{}], invalid: [null, "everything"] },
	},
});
