// Cross-package cycle gate: `bun scripts/cycle-check.ts [workspace-root]`, defaulting to the cwd.
import { findWorkspaceCycles, ManifestError } from "./workspace-cycles.ts";

const root = process.argv[2] ?? process.cwd();

try {
	const verdict = await findWorkspaceCycles(root);
	if (verdict.kind === "cycles") {
		console.error(`Found ${verdict.cycles.length} cross-package dependency cycle(s):`);
		for (const cycle of verdict.cycles) {
			console.error([...cycle, cycle[0]].join(" → "));
		}
		process.exit(1);
	}
	console.log("No cross-package dependency cycles.");
} catch (error) {
	if (!(error instanceof ManifestError)) throw error;
	console.error(error.message);
	process.exit(1);
}
