// Native-code gate for plugins: `bun scripts/native-check.ts [workspace-root]`, defaulting to the cwd.
import { type Evidence, findNativeCode, MissingDependencyError } from "./native-code.ts";
import { ManifestError } from "./workspace-cycles.ts";

const root = process.argv[2] ?? process.cwd();

const formatEvidence = (evidence: Evidence) => {
	switch (evidence.kind) {
		case "file":
			return `ships ${evidence.file}`;
		case "gypfile":
			return 'declares "gypfile"';
		case "source":
			return `${evidence.file} uses ${evidence.uses}`;
	}
};

try {
	const verdict = await findNativeCode(root);
	if (verdict.kind === "native") {
		console.error(
			"Plugins may not depend on native add-ons or Wasm: a Worker can't safely terminate them " +
				"(ADR-0031, mitigation 4). Found:",
		);
		for (const finding of verdict.findings) {
			console.error(`\n${finding.chain.join(" → ")}`);
			for (const evidence of finding.evidence) console.error(`  ${formatEvidence(evidence)}`);
		}
		process.exit(1);
	}
	console.log("No native add-ons or Wasm in any plugin's dependencies.");
} catch (error) {
	if (!(error instanceof ManifestError || error instanceof MissingDependencyError)) throw error;
	console.error(error.message);
	process.exit(1);
}
