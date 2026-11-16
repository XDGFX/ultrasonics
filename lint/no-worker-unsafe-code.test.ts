import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
	message: string;
	location: { start: { line: number; column: number } };
}

afterAll(() => {
	for (const dir of probeDirs) rmSync(dir, { recursive: true, force: true });
});

// `span` is where the diagnostic starts; `decision` is the ADR its message cites.
const banned = [
	{
		what: "Bun.sleepSync",
		source: "Bun.sleepSync(10);\n",
		span: "Bun.sleepSync",
		decision: "ADR-0010",
	},
	{
		what: "Atomics.wait",
		source: "export const wait = Atomics.wait;\n",
		span: "Atomics.wait",
		decision: "ADR-0010",
	},
	{
		what: "WebAssembly",
		source: "export const wasm = WebAssembly.compile;\n",
		span: "WebAssembly",
		decision: "ADR-0031",
	},
	{
		what: "globalThis.WebAssembly",
		source: "export const wasm = globalThis.WebAssembly;\n",
		span: "WebAssembly",
		decision: "ADR-0031",
	},
	{
		what: "process.dlopen",
		source: "process.dlopen({ exports: {} }, 'addon');\n",
		span: "process.dlopen",
		decision: "ADR-0031",
	},
	{
		what: "a bun:ffi import",
		source: 'import { dlopen } from "bun:ffi";\nexport { dlopen };\n',
		span: '"bun:ffi"',
		decision: "ADR-0031",
	},
	{
		what: "a bare bun:ffi import",
		source: 'import "bun:ffi";\n',
		span: '"bun:ffi"',
		decision: "ADR-0031",
	},
	{
		what: "a bun:ffi re-export",
		source: 'export { dlopen } from "bun:ffi";\n',
		span: '"bun:ffi"',
		decision: "ADR-0031",
	},
	{
		what: "a dynamic bun:ffi import",
		source: 'export const ffi = import("bun:ffi");\n',
		span: "import(",
		decision: "ADR-0031",
	},
	{
		what: "a dynamic bun:ffi import in backticks",
		source: "export const ffi = import(`bun:ffi`);\n",
		span: "import(",
		decision: "ADR-0031",
	},
	{
		what: "a .node import",
		source: 'import addon from "./build/addon.node";\nexport { addon };\n',
		span: '"./build/addon.node"',
		decision: "ADR-0031",
	},
	{
		what: "a dynamic .node import",
		source: 'export const addon = import("./addon.node");\n',
		span: "import(",
		decision: "ADR-0031",
	},
	{
		what: "a .node require in backticks",
		source: "export const addon = require(`./addon.node`);\n",
		span: "require(",
		decision: "ADR-0031",
	},
	{
		what: "a .node require",
		source: 'export const addon = require("./addon.node");\n',
		span: "require(",
		decision: "ADR-0031",
	},
];

describe("the no-worker-unsafe-code rule (ADR-0010 constraint 9, ADR-0031 mitigation 4)", () => {
	test.each(banned)("rejects $what under packages/plugins", ({ source, span, decision }) => {
		const run = lint("packages/plugins", source);
		expect(run.exitCode).not.toBe(0);
		// Grit diagnostics carry no rule name; this is the only plugin, at the banned form's span.
		expect(run.diagnostics).toEqual([
			expect.objectContaining({
				category: "plugin",
				message: expect.stringContaining(decision),
				location: expect.objectContaining({
					start: { line: 1, column: source.indexOf(span) + 1 },
				}),
			}),
		]);
	});

	test.each(banned)("leaves $what alone outside packages/plugins", ({ source }) => {
		expect(lint("packages/plugin-sdk", source).exitCode).toBe(0);
	});

	test.each([
		[
			"Atomics.waitAsync, which a Worker can still terminate",
			"export const wait = () => Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n",
		],
		[
			"bun:sqlite, which is built into Bun",
			'import { Database } from "bun:sqlite";\nexport { Database };\n',
		],
		["a string ending .node that is not imported", 'export const host = "plex.node";\n'],
	])("allows %s under packages/plugins", (_what, source) => {
		expect(lint("packages/plugins", source).exitCode).toBe(0);
	});
});
