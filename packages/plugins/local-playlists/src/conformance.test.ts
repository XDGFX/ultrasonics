import { afterAll } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import localPlaylists from "./index.ts";

// The conformance suite reads its fixtures when registered, so the folder exists before any test.
const root = mkdtempSync(join(tmpdir(), "ultrasonics-local-playlists-conformance-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
cpSync(join(import.meta.dir, "../test/fixtures"), root, { recursive: true });
const playlists = join(root, "playlists");

runConformance(localPlaylists, {
	persistentSettings: {
		valid: [
			{ playlistRoot: "D:\\Music", localRoot: join(root, "music") },
			{},
			{ playlistRoot: "", localRoot: " " },
			{ playlistRoot: "\\\\nas\\music", localRoot: "/music" },
		],
		invalid: [
			{ playlistRoot: "D:/Music" },
			{ localRoot: "/music" },
			{ playlistRoot: "Music", localRoot: "/music" },
			{ playlistRoot: "D:/Music", localRoot: "music" },
		],
	},
	instanceSettings: {
		inputs: {
			valid: [
				{ dir: playlists, recursive: true },
				{ dir: "/playlists" },
				{ dir: "D:\\Playlists", filter: "rock*, chill?" },
			],
			invalid: [{ dir: "" }, { dir: "playlists" }, { dir: "/playlists", recursive: "yes" }, {}],
		},
	},
});
