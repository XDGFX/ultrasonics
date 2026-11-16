import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import customFile from "./index.ts";

const dir = mkdtempSync(join(tmpdir(), "ultrasonics-custom-file-conformance-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

runConformance(customFile, {
	instanceSettings: {
		outputs: {
			valid: [
				{ dir },
				{ dir, fileName: "{name}.csv", pattern: '"{title}","{artists}",{isrc}' },
				{ dir, existing: "append" },
			],
			invalid: [
				{ dir, pattern: "{artist} - {song}" },
				{ dir, fileName: "../x.txt" },
				{ dir, fileName: "notes.db" },
			],
		},
	},
});
