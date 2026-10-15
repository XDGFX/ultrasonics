import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const fixture = (name: string) => join(import.meta.dir, "test", "fixtures", name);

const runCycleCheck = (root: string) => {
	const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "cycle-check.ts"), root]);
	return { exitCode: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
};

describe("cycle-check", () => {
	test("exits zero on an acyclic workspace", () => {
		expect(runCycleCheck(fixture("linear-chain")).exitCode).toBe(0);
	});

	test("prints every cycle closed back on its first package and exits non-zero", () => {
		const run = runCycleCheck(fixture("two-disjoint-cycles"));
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain("alpha → beta → alpha\n");
		expect(run.stderr).toContain("delta → gamma → delta\n");
	});

	test("exits non-zero on a malformed manifest", () => {
		const run = runCycleCheck(fixture("malformed-manifest"));
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain(join("packages", "beta", "package.json"));
	});

	test("exits non-zero when two members share a name, naming both manifests", () => {
		const run = runCycleCheck(fixture("duplicate-member-name"));
		expect(run.exitCode).toBe(1);
		expect(run.stderr).toContain(join("packages", "alpha", "package.json"));
		expect(run.stderr).toContain(join("packages", "duplicate", "package.json"));
	});
});
