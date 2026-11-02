/** Writes the baked logo files. Run with `bun run logo` in packages/web, and commit what it writes. */
import { logoFiles } from "./logo-files.ts";

for (const [path, content] of await logoFiles()) {
	await Bun.write(path, content);
	console.log(`wrote ${path}`);
}
