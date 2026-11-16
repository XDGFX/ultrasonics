import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const fixture = (name: string) => join(import.meta.dir, "test", "fixtures", name);

const runNativeCheck = (root: string) => {
	const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "native-check.ts"), root]);
	return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
};

describe("native-check", () => {
	test("exits zero when no plugin ships native code", () => {
		expect(runNativeCheck(fixture("natives-clean")).exitCode).toBe(0);
	});

	test("prints the chain to each native package and what it ships, citing ADR-0031", () => {
		const run = runNativeCheck(fixture("natives-transitive-binary"));
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain("ADR-0031");
		expect(run.stderr).toContain("plugin-p → a → b");
		expect(run.stderr).toContain("build/Release/b.node");
	});

	test("exits non-zero when a dependency isn't installed", () => {
		const run = runNativeCheck(fixture("natives-missing-dependency"));
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain("never-installed");
	});
});
