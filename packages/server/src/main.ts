// The process entry: boots the server, or explains every setting it refused and exits non-zero.
import { officialPlugins } from "@ultrasonics/registry";
import { boot } from "./boot.ts";
import { consoleLogger } from "./logger.ts";

const booting = boot({ env: process.env, registry: officialPlugins, logger: consoleLogger });

// Handled before boot settles, because as PID 1 in a container an unhandled signal is ignored and
// Docker kills the process.
let stopping = false;
async function stop(signal: NodeJS.Signals): Promise<void> {
	if (stopping) return;
	stopping = true;
	consoleLogger.info(`Received ${signal}; stopping`);
	try {
		const result = await booting;
		if (result.ok) await result.stop();
		process.exit(0);
	} catch (error) {
		console.error("ultrasonics failed to stop cleanly:", error);
		process.exit(1);
	}
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

try {
	const result = await booting;
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
