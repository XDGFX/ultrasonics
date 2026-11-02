import { expect, test } from "bun:test";
import { dirname, join, relative } from "node:path";

/** Every module `entry` reaches: local files relative to `src`, and the packages it imports. */
async function importGraph(entry: string) {
	const transpiler = new Bun.Transpiler({ loader: "ts" });
	const files = new Set<string>();
	const packages = new Set<string>();
	const visit = async (file: string) => {
		if (files.has(file)) return;
		files.add(file);
		for (const { path } of transpiler.scanImports(await Bun.file(file).text())) {
			if (path.startsWith(".")) await visit(join(dirname(file), path));
			else packages.add(path);
		}
	};
	await visit(entry);
	return { files: [...files].map((file) => relative(import.meta.dir, file)).sort(), packages };
}

test("the run-events subpath reaches nothing in the runner, only Zod and the SDK", async () => {
	const graph = await importGraph(join(import.meta.dir, "run-events.ts"));

	expect(graph.files).toEqual(["journal.ts", "run-event.ts", "run-events.ts"]);
	expect([...graph.packages].sort()).toEqual(["@ultrasonics/plugin-sdk", "zod"]);
});
