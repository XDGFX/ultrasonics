import { expect, test } from "bun:test";
import { logoFiles } from "./logo-files.ts";

test("the committed logo files are what the renderer makes now (else run `bun run logo`)", async () => {
	for (const [path, content] of await logoFiles()) {
		const committed = Bun.file(path);
		const expected = typeof content === "string" ? await committed.text() : await committed.bytes();
		expect({ path, content }).toEqual({ path, content: expected });
	}
}, 30_000);
