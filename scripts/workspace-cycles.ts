import { join } from "node:path";
import { z } from "zod";

/**
 * Each cycle is listed once, starting at its alphabetically first package, and the cycles are
 * sorted, so the verdict for a given workspace is deterministic.
 */
export type CycleVerdict = { kind: "acyclic" } | { kind: "cycles"; cycles: string[][] };

const dependencyMap = z.record(z.string(), z.string()).optional();

const memberManifest = z.object({
	name: z.string().min(1),
	dependencies: dependencyMap,
	devDependencies: dependencyMap,
	peerDependencies: dependencyMap,
	optionalDependencies: dependencyMap,
});

const rootManifest = z.object({
	workspaces: z
		.union([z.array(z.string()), z.object({ packages: z.array(z.string()) })])
		.optional(),
});

export async function findWorkspaceCycles(root: string): Promise<CycleVerdict> {
	const graph = await readWorkspaceGraph(root);
	const cycles = elementaryCycles(graph);
	return cycles.length === 0 ? { kind: "acyclic" } : { kind: "cycles", cycles };
}

/** A workspace manifest that could not be read, parsed or validated. */
export class ManifestError extends Error {
	constructor(
		readonly path: string,
		options: { cause: unknown },
	) {
		super(`cannot use manifest ${path}: ${String(options.cause)}`, options);
		this.name = "ManifestError";
	}
}

async function readManifest<T>(path: string, schema: z.ZodType<T>): Promise<T> {
	try {
		return schema.parse(JSON.parse(await Bun.file(path).text()));
	} catch (cause) {
		throw new ManifestError(path, { cause });
	}
}

async function readWorkspaceGraph(root: string): Promise<Map<string, string[]>> {
	const { workspaces = [] } = await readManifest(join(root, "package.json"), rootManifest);
	const patterns = Array.isArray(workspaces) ? workspaces : workspaces.packages;

	const members = new Map<string, z.infer<typeof memberManifest>>();
	for (const pattern of patterns) {
		for await (const path of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root })) {
			const manifest = await readManifest(join(root, path), memberManifest);
			members.set(manifest.name, manifest);
		}
	}

	const graph = new Map<string, string[]>();
	for (const [name, manifest] of members) {
		const named = [
			manifest.dependencies,
			manifest.devDependencies,
			manifest.peerDependencies,
			manifest.optionalDependencies,
		].flatMap((deps) => Object.keys(deps ?? {}));
		graph.set(name, [...new Set(named.filter((dep) => members.has(dep)))].sort());
	}
	return graph;
}

// Enumerates every elementary cycle once by rooting each at its smallest member: from each start,
// the search only visits packages that sort after it.
function elementaryCycles(graph: Map<string, string[]>): string[][] {
	const cycles: string[][] = [];
	const starts = [...graph.keys()].sort();
	for (const start of starts) {
		const path = [start];
		const walk = (node: string) => {
			for (const next of graph.get(node) ?? []) {
				if (next === start) {
					cycles.push([...path]);
				} else if (next > start && !path.includes(next)) {
					path.push(next);
					walk(next);
					path.pop();
				}
			}
		};
		walk(start);
	}
	return cycles.sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
}
