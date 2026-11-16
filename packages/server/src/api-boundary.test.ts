import { afterEach, expect, test } from "bun:test";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const BIOME = join(REPO_ROOT, "node_modules", ".bin", "biome");
let root: string | undefined;

afterEach(() => {
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

/** Lints one import at `path`, under a copy of the repo's Biome config, counting restricted imports. */
function restrictedImports(path: string, specifier: string, names?: string): number {
	root = mkdtempSync(join(tmpdir(), "ultrasonics-lint-"));
	mkdirSync(dirname(join(root, path)), { recursive: true });
	const source = names
		? `export { ${names} } from "${specifier}";\n`
		: `export * from "${specifier}";\n`;
	writeFileSync(join(root, path), source);
	copyFileSync(join(REPO_ROOT, "biome.json"), join(root, "biome.json"));
	cpSync(join(REPO_ROOT, "lint"), join(root, "lint"), { recursive: true });
	const result = Bun.spawnSync(
		[BIOME, "lint", "--vcs-enabled=false", "--reporter=json", "--max-diagnostics=none", path],
		{ cwd: root, stdout: "pipe", stderr: "pipe" },
	);
	const report: { diagnostics: { category: string }[] } = JSON.parse(result.stdout.toString());
	return report.diagnostics.filter((d) => d.category === "lint/style/noRestrictedImports").length;
}

test.each([
	["zod", 0],
	["@ultrasonics/plugin-sdk", 0],
	["@ultrasonics/core/run-events", 0],
	["@ultrasonics/core", 1],
	["hono", 1],
	["./app.ts", 1],
])("the API schemas importing %s give %i errors", (specifier, errors) => {
	expect(restrictedImports("packages/server/src/api.ts", specifier)).toBe(errors);
});

test.each([
	["Schedule, RunTrigger", 0],
	["openDatabase", 1],
	["resolveEncryptionKey", 1],
])("the API schemas importing { %s } from the db give %i errors", (names, errors) => {
	expect(restrictedImports("packages/server/src/api.ts", "@ultrasonics/db", names)).toBe(errors);
});

test.each([
	["@ultrasonics/server/api", 0],
	["@ultrasonics/server", 1],
	["@ultrasonics/server/src/app.ts", 1],
])("the UI importing %s gives %i errors", (specifier, errors) => {
	expect(restrictedImports("packages/web/src/probe.ts", specifier)).toBe(errors);
});
