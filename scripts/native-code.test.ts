import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findNativeCode, MissingDependencyError } from "./native-code.ts";

const fixture = (name: string) => join(import.meta.dir, "test", "fixtures", name);

describe("findNativeCode", () => {
	test("a plugin whose shipped tree has no native code is clean", async () => {
		// Its dev dependency ships a .node file, a non-plugin package depends on a binding.gyp, an
		// absent optional dependency is skipped, and a .d.ts naming WebAssembly is only a type.
		expect(await findNativeCode(fixture("natives-clean"))).toEqual({ kind: "clean" });
	});

	test("a .node binary two dependencies down is found, with the chain that pulls it in", async () => {
		expect(await findNativeCode(fixture("natives-transitive-binary"))).toEqual({
			kind: "native",
			findings: [
				{
					chain: ["plugin-p", "a", "b"],
					evidence: [{ kind: "file", file: "build/Release/b.node" }],
				},
			],
		});
	});

	test("a dependency with a binding.gyp is found", async () => {
		expect(await findNativeCode(fixture("natives-binding-gyp"))).toEqual({
			kind: "native",
			findings: [
				{
					chain: ["plugin-p", "a"],
					evidence: [{ kind: "file", file: "binding.gyp" }],
				},
			],
		});
	});

	test("a dependency that declares gypfile is found", async () => {
		expect(await findNativeCode(fixture("natives-gypfile"))).toEqual({
			kind: "native",
			findings: [{ chain: ["plugin-p", "a"], evidence: [{ kind: "gypfile" }] }],
		});
	});

	test("a dependency that ships a .wasm file is found", async () => {
		expect(await findNativeCode(fixture("natives-wasm"))).toEqual({
			kind: "native",
			findings: [
				{
					chain: ["plugin-p", "a"],
					evidence: [{ kind: "file", file: "dist/a.wasm" }],
				},
			],
		});
	});

	test("a dependency whose code reaches for WebAssembly, process.dlopen or bun:ffi is found", async () => {
		expect(await findNativeCode(fixture("natives-source"))).toEqual({
			kind: "native",
			findings: [
				{
					chain: ["plugin-p", "a"],
					evidence: [
						{ kind: "source", file: "ffi.mjs", uses: "bun:ffi" },
						{ kind: "source", file: "index.js", uses: "WebAssembly" },
						{ kind: "source", file: "load.cjs", uses: "process.dlopen" },
					],
				},
			],
		});
	});

	test("the walk follows bun's isolated layout through workspace packages and symlinks", async () => {
		expect(await findNativeCode(fixture("natives-isolated"))).toEqual({
			kind: "native",
			findings: [
				{
					chain: ["plugin-p", "sdk", "a", "b"],
					evidence: [{ kind: "file", file: "b.node" }],
				},
			],
		});
	});

	test("a required dependency that isn't installed fails, naming it and its dependent", async () => {
		const error = await findNativeCode(fixture("natives-missing-dependency")).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(MissingDependencyError);
		expect(error).toMatchObject({ chain: ["plugin-p", "a"], dependency: "never-installed" });
	});
});
