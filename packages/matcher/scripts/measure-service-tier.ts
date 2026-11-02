/**
 * Measures a pairwise function on the cached service tier, by hand and never under `bun test`
 * (spec #117). A miss here is fixed by adding a CC0 or hand-written case that reproduces it,
 * never by tuning against the cache (#104 §4). Share the figures only, never song data.
 *
 *   bun run measure-service-tier
 */
import { join } from "node:path";
import { formatReport, measure, type PairwiseFunction } from "../src/harness.ts";
import { loadServiceTier } from "../src/service-tier.ts";

const cachePath = join(import.meta.dir, "../service-tier-cache/service-tier.json");

// The matcher ticket (#120) replaces this with `match`; until then there is nothing to measure.
const pairwise: PairwiseFunction | undefined = undefined;

const loaded = await loadServiceTier(cachePath);
if (loaded.kind === "missing") {
	console.error(`No service-tier cache at ${cachePath}. Run collect-service-tier first.`);
	console.error("No figures: the service tier was not measured.");
	process.exit(1);
}
const { tier } = loaded;
for (const service of tier.skipped) console.warn(`Skipped ${service} when collecting: no keys.`);
console.log(`${tier.cases.length} cases; ${tier.dropped} dropped as missing on a service.`);
if (!pairwise) {
	console.error("No matcher to measure yet. No figures.");
	process.exit(1);
}
console.log(formatReport(measure(pairwise, tier.cases)));
