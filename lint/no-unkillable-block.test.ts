import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const probeDirs: string[] = [];

/** Lints `source` as if it lived at `relativeDir/probe.ts`, with the repo's own Biome config. */
function lint(relativeDir: string, source: string) {
	const dir = join(root, relativeDir, `lint-probe-${crypto.randomUUID()}`);
	probeDirs.push(dir);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "probe.ts");
	writeFileSync(file, source);
	const run = Bun.spawnSync(
		["bunx", "biome", "lint", "--reporter=json", "--max-diagnostics=50", file],
		{ cwd: root },
	);
	const report = JSON.parse(run.stdout.toString()) as { diagnostics: Diagnostic[] };
	return { exitCode: run.exitCode, diagnostics: report.diagnostics };
}

interface Diagnostic {
	category: string;
	location: { start: { line: number; column: number } };
}

afterAll(() => {
	for (const dir of probeDirs) rmSync(dir, { recursive: true, force: true });
	// Leaves no empty `packages/plugins` behind while no plugin exists yet.
	try {
		rmdirSync(join(root, "packages", "plugins"));
	} catch {}
});

describe("the no-unkillable-block rule (ADR-0010 constraint 9)", () => {
	test.each([
		["Bun.sleepSync", "Bun.sleepSync(10);\n"],
		["Atomics.wait", "export const wait = Atomics.wait;\n"],
	])("rejects %s under packages/plugins", (blocker, source) => {
		const run = lint("packages/plugins", source);
		expect(run.exitCode).not.toBe(0);
		// Grit diagnostics carry no rule name; this is the only plugin, at the blocker's span.
		expect(run.diagnostics).toEqual([
			expect.objectContaining({
				category: "plugin",
				location: expect.objectContaining({
					start: { line: 1, column: source.indexOf(blocker) + 1 },
				}),
			}),
		]);
	});

	test("allows Atomics.waitAsync, which a Worker can still terminate", () => {
		const source =
			"export const wait = () => Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n";
		expect(lint("packages/plugins", source).exitCode).toBe(0);
	});

	test("leaves code outside packages/plugins alone", () => {
		expect(lint("packages/plugin-sdk", "Bun.sleepSync(10);\n").exitCode).toBe(0);
	});
});
