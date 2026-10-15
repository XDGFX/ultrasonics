import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findWorkspaceCycles, ManifestError } from "./workspace-cycles.ts";

const fixture = (name: string) => join(import.meta.dir, "test", "fixtures", name);

describe("findWorkspaceCycles", () => {
	test("a workspace with zero packages is acyclic", async () => {
		expect(await findWorkspaceCycles(fixture("zero-packages"))).toEqual({ kind: "acyclic" });
	});

	test("two packages that depend on each other form one cycle", async () => {
		expect(await findWorkspaceCycles(fixture("two-package-cycle"))).toEqual({
			kind: "cycles",
			cycles: [["alpha", "beta"]],
		});
	});

	test("a linear chain of dependencies is acyclic", async () => {
		expect(await findWorkspaceCycles(fixture("linear-chain"))).toEqual({ kind: "acyclic" });
	});

	test("three packages that depend on each other in a ring form one cycle", async () => {
		expect(await findWorkspaceCycles(fixture("three-package-cycle"))).toEqual({
			kind: "cycles",
			cycles: [["alpha", "beta", "gamma"]],
		});
	});

	test("two disjoint cycles are both reported", async () => {
		expect(await findWorkspaceCycles(fixture("two-disjoint-cycles"))).toEqual({
			kind: "cycles",
			cycles: [
				["alpha", "beta"],
				["delta", "gamma"],
			],
		});
	});

	test("a cycle closed only through devDependencies is still a cycle", async () => {
		expect(await findWorkspaceCycles(fixture("dev-dependency-cycle"))).toEqual({
			kind: "cycles",
			cycles: [["alpha", "beta"]],
		});
	});

	test("an external dependency whose name resembles a member adds no edge", async () => {
		expect(await findWorkspaceCycles(fixture("similar-external-name"))).toEqual({
			kind: "acyclic",
		});
	});

	test("a malformed member manifest fails, naming the manifest", async () => {
		const root = fixture("malformed-manifest");
		const error = await findWorkspaceCycles(root).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ManifestError);
		expect((error as ManifestError).path).toBe(join(root, "packages", "beta", "package.json"));
	});
});
