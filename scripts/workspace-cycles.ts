import { join } from "node:path";
import { z } from "zod";

/**
 * Each cycle is listed once, starting at its alphabetically first package, and the cycles are
 * sorted, so the verdict for a given workspace is deterministic.
 */
export type CycleVerdict = { kind: "acyclic" } | { kind: "cycles"; cycles: string[][] };

const dependencyFields = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

const dependencyMap = z.record(z.string(), z.string()).optional();

const dependencyShape = Object.fromEntries(
	dependencyFields.map((field) => [field, dependencyMap]),
) as Record<(typeof dependencyFields)[number], typeof dependencyMap>;

const memberManifest = z.object({ name: z.string().min(1), ...dependencyShape });

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

	const paths = new Set<string>();
	for (const pattern of patterns) {
		for await (const path of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root })) {
			paths.add(join(root, path));
		}
	}

	// Sorted so that which of two same-named manifests is reported does not depend on scan order.
	const members = new Map<string, { path: string; manifest: z.infer<typeof memberManifest> }>();
	for (const path of [...paths].sort()) {
		const manifest = await readManifest(path, memberManifest);
		const clash = members.get(manifest.name);
		if (clash) {
			throw new ManifestError(path, {
				cause: `package name "${manifest.name}" is already used by ${clash.path}`,
			});
		}
		members.set(manifest.name, { path, manifest });
	}

	const graph = new Map<string, string[]>();
	for (const [name, { manifest }] of members) {
		const named = dependencyFields.flatMap((field) => Object.keys(manifest[field] ?? {}));
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
