import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import localPlaylists from "./index.ts";

// The conformance suite reads its fixtures when registered, so the folder exists before any test.
const root = mkdtempSync(join(tmpdir(), "ultrasonics-local-playlists-conformance-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
cpSync(join(import.meta.dir, "../test/fixtures"), root, { recursive: true });
const playlists = join(root, "playlists");
const written = join(root, "written");
mkdirSync(written);

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
		outputs: {
			valid: [{ dir: written }, { dir: "D:\\Playlists", backups: "0" }, { dir: "/playlists" }],
			invalid: [
				{ dir: "playlists" },
				{ dir: "/playlists", backups: "4" },
				{ dir: "/p", backups: 3 },
			],
		},
	},
});

test("the default song dict's song with a location is written as a path", () => {
	expect(readFileSync(join(written, "Running.m3u8"), "utf8")).toEndWith(
		"#EXTINF:-1,Untagged\n/music/untagged.mp3\n",
	);
});
