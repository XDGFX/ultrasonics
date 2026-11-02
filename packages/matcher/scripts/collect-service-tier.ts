/**
 * Fetches the service tier: each MusicBrainz case's sides from Spotify and Deezer by ISRC, into
 * the git-ignored `service-tier-cache/` (spec #117, "The service tier"). Run by hand, never by
 * `bun test`; the cache is held out, and is never committed or pushed anywhere.
 *
 *   SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… bun run collect-service-tier
 *
 * Spotify uses the client-credentials grant with your own app; Deezer needs no key.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { MatchCase } from "../src/match-case.ts";
import { collectServiceTier } from "../src/service-tier.ts";

const cacheDir = join(import.meta.dir, "../service-tier-cache");
const fixture = join(import.meta.dir, "../test/fixtures/match-dataset/musicbrainz.json");
const cases = z.array(MatchCase).parse(JSON.parse(await readFile(fixture, "utf8")));

const tier = await collectServiceTier(cases, process.env, fetch, { pauseMs: 250 });
for (const service of tier.skipped) console.warn(`Skipped ${service}: no keys in the environment.`);
await mkdir(cacheDir, { recursive: true });
await writeFile(join(cacheDir, "service-tier.json"), JSON.stringify(tier));
console.log(
	`Cached ${tier.cases.length} cases; dropped ${tier.dropped} missing on a service, of ${cases.length}.`,
);
