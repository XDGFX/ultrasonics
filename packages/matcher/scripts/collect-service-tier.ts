/**
 * Fetches the service tier: each MusicBrainz case's sides from Spotify and Deezer by ISRC, into
 * the git-ignored `service-tier-cache/` (spec #117, "The service tier"). Run by hand, never by
 * `bun test`; the cache is held out, and is never committed or pushed anywhere.
 *
 *   SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… bun run collect-service-tier
 *
 * Spotify uses the client-credentials grant with your own app; Deezer needs no key. Rate limits
 * are waited out; each lookup is saved as it is made, so a stopped run resumes where it left off.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { MatchCase } from "../src/match-case.ts";
import { collectServiceTier, Lookups } from "../src/service-tier.ts";

const cacheDir = join(import.meta.dir, "../service-tier-cache");
const lookupsPath = join(cacheDir, "lookups.json");
const fixture = join(import.meta.dir, "../test/fixtures/match-dataset/musicbrainz.json");
const cases = z.array(MatchCase).parse(JSON.parse(await readFile(fixture, "utf8")));

await mkdir(cacheDir, { recursive: true });
const saved = await readFile(lookupsPath, "utf8").catch(() => undefined);
const lookups = saved === undefined ? {} : Lookups.parse(JSON.parse(saved));
if (saved !== undefined) console.error(`Resuming with ${Object.keys(lookups).length} lookups.`);
// Written aside then renamed, so a run killed mid-write leaves the last good progress.
const save = async () => {
	await writeFile(`${lookupsPath}.partial`, JSON.stringify(lookups));
	await rename(`${lookupsPath}.partial`, lookupsPath);
};

const tier = await collectServiceTier(cases, process.env, fetch, {
	// Each case asks Spotify once; at 250 ms a development-mode app was banned for a day after ~700.
	pauseMs: 1500,
	lookups,
	checkpoint: save,
}).finally(save);
for (const service of tier.skipped) console.warn(`Skipped ${service}: no keys in the environment.`);
await writeFile(join(cacheDir, "service-tier.json"), JSON.stringify(tier));
console.log(
	`Cached ${tier.cases.length} cases; dropped ${tier.dropped} missing on a service, of ${cases.length}.`,
);
