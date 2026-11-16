import { describe, expect, test } from "bun:test";
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { useTempDir, useTwoAccounts } from "./test-support.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const BIOME = join(REPO_ROOT, "node_modules", ".bin", "biome");
const FIXTURE = readFileSync(
	join(import.meta.dir, "..", "test", "fixtures", "lint", "narrow-imports.ts"),
);

describe("the narrow subpaths", () => {
	const tempDir = useTempDir();

	/** Lints the fixture as though it lived at `path`, under a copy of the repo's Biome config and plugins. */
	function restrictedImportsAt(path: string): unknown[] {
		const root = tempDir();
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), FIXTURE);
		copyFileSync(join(REPO_ROOT, "biome.json"), join(root, "biome.json"));
		cpSync(join(REPO_ROOT, "lint"), join(root, "lint"), { recursive: true });
		const result = Bun.spawnSync(
			[BIOME, "lint", "--vcs-enabled=false", "--reporter=json", "--max-diagnostics=none", path],
			{ cwd: root, stdout: "pipe", stderr: "pipe" },
		);
		const report: { diagnostics: { category: string }[] } = JSON.parse(result.stdout.toString());
		return report.diagnostics.filter(
			(diagnostic) => diagnostic.category === "lint/style/noRestrictedImports",
		);
	}

	test.each([
		["a feature route", "packages/server/src/routes/applets.ts", 3],
		["the runner", "packages/core/src/applet-runner.ts", 3],
		["boot", "packages/server/src/boot.ts", 0],
		["the session middleware", "packages/server/src/session-middleware.ts", 2],
		["the operator settings", "packages/server/src/operator-settings.ts", 2],
		["the scheduler", "packages/server/src/scheduler.ts", 2],
		["the webhook route", "packages/server/src/webhook-route.ts", 2],
		["the v1 importer", "packages/v1-import/src/import-v1.ts", 2],
	])("importing all three from %s (%s) gives %i lint errors", (_, path, errors) => {
		expect(restrictedImportsAt(path)).toHaveLength(errors);
	});
});

describe("the raw connection", () => {
	const twoAccounts = useTwoAccounts(useTempDir());

	test.each(["@ultrasonics/db/connection", "@ultrasonics/db/src/connection.ts"])(
		"cannot be imported as %s",
		async (specifier) => {
			await expect(import(specifier)).rejects.toThrow();
		},
	);

	test("is not reachable from the handle", async () => {
		const { db } = await twoAccounts();
		expect(Object.keys(db).sort()).toEqual(["close", "storeFor"]);
	});
});
