// The process entry: boots the server, or explains every setting it refused and exits non-zero.
import { officialPlugins } from "@ultrasonics/registry";
import { boot } from "./boot.ts";
import { consoleLogger } from "./logger.ts";

try {
	const result = await boot({ env: process.env, registry: officialPlugins, logger: consoleLogger });
	if (!result.ok) {
		console.error("ultrasonics cannot start until these are fixed:\n");
		for (const problem of result.problems)
			console.error(`${problem.setting}\n  ${problem.message}\n`);
		process.exit(1);
	}
} catch (error) {
	console.error("ultrasonics failed to start:", error);
	process.exit(1);
}
