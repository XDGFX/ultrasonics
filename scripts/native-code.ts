import { existsSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { readManifest as readManifestAt } from "./workspace-cycles.ts";

/** Why a package counts as native code a Worker can't safely terminate (ADR-0031, mitigation 4). */
export type Evidence =
	| { kind: "file"; file: string }
	| { kind: "gypfile" }
	| { kind: "source"; file: string; uses: SourceUse };

type SourceUse = "WebAssembly" | "process.dlopen" | "bun:ffi";

/** One package in a plugin's shipped tree, reached from the plugin (`chain[0]`) along `chain`. */
export interface Finding {
	chain: string[];
	evidence: Evidence[];
}

/** Plugins are sorted by name and each one's packages are listed nearest first. */
export type NativeVerdict = { kind: "clean" } | { kind: "native"; findings: Finding[] };

/** A dependency a package requires that no `node_modules` between it and the root holds. */
export class MissingDependencyError extends Error {
	constructor(
		readonly chain: string[],
		readonly dependency: string,
	) {
		super(`${chain.join(" → ")} requires ${dependency}, which is not installed; run bun install`);
		this.name = "MissingDependencyError";
	}
}

const dependencyMap = z.record(z.string(), z.string()).optional();

const manifestSchema = z.object({
	name: z.string().min(1),
	gypfile: z.boolean().optional(),
	dependencies: dependencyMap,
	optionalDependencies: dependencyMap,
	peerDependencies: dependencyMap,
});

type Manifest = z.infer<typeof manifestSchema>;

const nativeFile = /(\.node|\.wasm|^binding\.gyp)$/;
const sourceFile = /\.(c|m)?[jt]s$/;
const declarationFile = /\.d\.(c|m)?ts$/;
const sourceUses: [SourceUse, RegExp][] = [
	["WebAssembly", /\bWebAssembly\b/],
	["process.dlopen", /\bprocess\.dlopen\b/],
	["bun:ffi", /["'`]bun:ffi["'`]/],
];

/**
 * Walks every `packages/plugins/*` package's installed runtime tree (`dependencies`, plus any
 * installed optional or peer dependency) and reports each package that ships a `.node` or `.wasm`
 * file, has a `binding.gyp` or declares `gypfile`, or whose code names WebAssembly,
 * `process.dlopen` or `bun:ffi`. Dev dependencies never reach a plugin's Worker, so are skipped.
 */
export async function findNativeCode(root: string): Promise<NativeVerdict> {
	const workspaceRoot = await realpath(root);
	const pluginDirs: string[] = [];
	for await (const path of new Bun.Glob("packages/plugins/*/package.json").scan({
		cwd: workspaceRoot,
	})) {
		pluginDirs.push(join(workspaceRoot, dirname(path)));
	}

	const plugins = await Promise.all(
		pluginDirs.map(async (dir) => ({ dir, manifest: await readManifest(dir) })),
	);
	plugins.sort((a, b) => (a.manifest.name < b.manifest.name ? -1 : 1));

	const findings: Finding[] = [];
	for (const plugin of plugins) {
		findings.push(...(await walkPlugin(workspaceRoot, plugin.dir, plugin.manifest)));
	}
	return findings.length === 0 ? { kind: "clean" } : { kind: "native", findings };
}

// Breadth-first, so each package is reported along its shortest chain from the plugin.
async function walkPlugin(root: string, dir: string, manifest: Manifest): Promise<Finding[]> {
	const findings: Finding[] = [];
	const seen = new Set<string>([dir]);
	const queue = [{ dir, manifest, chain: [manifest.name] }];
	for (let next = queue.shift(); next; next = queue.shift()) {
		const evidence = await inspect(next.dir, next.manifest);
		if (evidence.length > 0) {
			findings.push({ chain: next.chain, evidence });
		}
		for (const { name, required } of runtimeDependencies(next.manifest)) {
			const found = await resolve(root, next.dir, name);
			if (!found) {
				if (required) throw new MissingDependencyError(next.chain, name);
				continue;
			}
			if (seen.has(found)) continue;
			seen.add(found);
			const child = await readManifest(found);
			queue.push({ dir: found, manifest: child, chain: [...next.chain, child.name] });
		}
	}
	return findings;
}

function runtimeDependencies(manifest: Manifest): { name: string; required: boolean }[] {
	const required = new Set(Object.keys(manifest.dependencies ?? {}));
	const optional = [
		...Object.keys(manifest.optionalDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	].filter((name) => !required.has(name));
	return [
		...[...required].map((name) => ({ name, required: true })),
		...[...new Set(optional)].map((name) => ({ name, required: false })),
	].sort((a, b) => (a.name < b.name ? -1 : 1));
}

// Node's lookup: the nearest `node_modules/<name>` from the package's real directory up to the
// workspace root. Starting from the real path is what makes bun's isolated layout resolve.
async function resolve(root: string, from: string, name: string): Promise<string | undefined> {
	for (let dir = from; !relative(root, dir).startsWith(".."); dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) return realpath(candidate);
		if (dir === root) break;
	}
	return undefined;
}

async function inspect(dir: string, manifest: Manifest): Promise<Evidence[]> {
	const evidence: Evidence[] = manifest.gypfile ? [{ kind: "gypfile" }] : [];
	for (const file of await packageFiles(dir)) {
		const path = relative(dir, file);
		if (nativeFile.test(path)) evidence.push({ kind: "file", file: path });
		if (sourceFile.test(path) && !declarationFile.test(path)) {
			const text = await Bun.file(file).text();
			for (const [uses, pattern] of sourceUses) {
				if (pattern.test(text)) evidence.push({ kind: "source", file: path, uses });
			}
		}
	}
	return evidence;
}

// A package's own files, sorted; nested `node_modules` are other packages, reached by resolution.
async function packageFiles(dir: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory() && entry.name !== "node_modules") {
			files.push(...(await packageFiles(path)));
		} else if (entry.isFile()) {
			files.push(path);
		}
	}
	return files.sort();
}

const readManifest = (dir: string) => readManifestAt(join(dir, "package.json"), manifestSchema);
