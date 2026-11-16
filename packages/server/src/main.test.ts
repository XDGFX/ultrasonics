import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LISTENING } from "./boot.ts";
import { TEST_KEY_HEX } from "./test-support.ts";

let dataDir: string | undefined;
afterEach(() => {
	if (dataDir) rmSync(dataDir, { recursive: true, force: true });
	dataDir = undefined;
});

/** Reads the process's stdout until a line contains `text`. */
async function waitFor(stdout: ReadableStream<Uint8Array>, text: string): Promise<void> {
	const decoder = new TextDecoder();
	let seen = "";
	for await (const chunk of stdout) {
		seen += decoder.decode(chunk, { stream: true });
		if (seen.includes(text)) return;
	}
	throw new Error(`the server exited without printing "${text}":\n${seen}`);
}

test.each(["SIGTERM", "SIGINT"] as const)(
	"the server stops cleanly and exits 0 on %s",
	async (signal) => {
		dataDir = mkdtempSync(join(tmpdir(), "ultrasonics-main-"));
		const server = Bun.spawn(["bun", join(import.meta.dir, "main.ts")], {
			env: {
				...process.env,
				DATA_DIR: dataDir,
				PORT: "0",
				ENCRYPTION_KEY: TEST_KEY_HEX,
				AUTH_SOURCE: "bootstrapped",
			},
			stdout: "pipe",
			stderr: "inherit",
		});
		await waitFor(server.stdout, LISTENING);

		server.kill(signal);

		expect(await server.exited).toBe(0);
	},
);
