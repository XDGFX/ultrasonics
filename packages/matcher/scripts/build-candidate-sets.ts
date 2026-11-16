/**
 * Builds the CC0 tier's candidate sets for `bestMatch` (#132) from MusicBrainz core data.
 *
 *   bun run build-candidate-sets
 *
 * For each remix, re-recording, live and edit trap whose original recording MusicBrainz lists on
 * another release, the source is the original on that release, and the candidates are the trap's
 * two sides in an order drawn from the seed. It reads every recording in the tier from the search
 * service, 20 MBIDs a request, at most one request a second, caching responses in the git-ignored
 * `musicbrainz-cache/`. A cold run takes about two minutes, and a later one can differ slightly as
 * MusicBrainz changes. Only core data is kept: titles, artist credits, lengths, release titles
 * and dates.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normaliseDate, type SongInput } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { CandidateSet, LookalikeCategory } from "../src/candidate-set.ts";
import { MatchCase } from "../src/match-case.ts";
import { normalise } from "../src/normalise.ts";
import { draw } from "../src/split.ts";
import tierJson from "../test/fixtures/match-dataset/musicbrainz.json";

const packageRoot = join(import.meta.dir, "..");
const cacheDir = join(packageRoot, "musicbrainz-cache");
const fixture = join(packageRoot, "test/fixtures/match-dataset/candidate-sets.json");
const userAgent = "ultrasonics-match-dataset/0.1 ( https://github.com/XDGFX/ultrasonics )";

const Recording = z.object({
	id: z.string(),
	title: z.string(),
	length: z.number().nullish(),
	releases: z
		.array(
			z.object({
				title: z.string(),
				date: z.string().optional(),
				media: z
					.array(
						z.object({
							track: z
								.array(z.object({ title: z.string(), length: z.number().nullish() }))
								.optional(),
						}),
					)
					.optional(),
			}),
		)
		.optional(),
});
type Recording = z.output<typeof Recording>;
const SearchPage = z.object({ recordings: z.array(Recording) });

const sha1 = (text: string) => new Bun.CryptoHasher("sha1").update(text).digest("hex");

async function get(url: string): Promise<z.output<typeof SearchPage>> {
	const file = join(cacheDir, `${sha1(url)}.json`);
	const cached = await readFile(file, "utf8").catch(() => undefined);
	if (cached !== undefined) return SearchPage.parse(JSON.parse(cached));
	for (let attempt = 0; ; attempt++) {
		await Bun.sleep(1100);
		const response = await fetch(url, { headers: { "User-Agent": userAgent } }).catch(
			() => undefined,
		);
		if (response?.ok) {
			const body = await response.text();
			await writeFile(file, body);
			return SearchPage.parse(JSON.parse(body));
		}
		if (attempt >= 5) throw new Error(`MusicBrainz gave ${response?.status} for ${url}`);
		await Bun.sleep(2000 * (attempt + 1));
	}
}

async function fetchRecordings(ids: readonly string[]): Promise<Map<string, Recording>> {
	const found = new Map<string, Recording>();
	for (let i = 0; i < ids.length; i += 20) {
		const batch = ids.slice(i, i + 20);
		const query = encodeURIComponent(batch.map((id) => `rid:${id}`).join(" OR "));
		const page = await get(
			`https://musicbrainz.org/ws/2/recording?query=${query}&limit=25&fmt=json`,
		);
		for (const recording of page.recordings) {
			if (batch.includes(recording.id)) found.set(recording.id, recording);
		}
		process.stdout.write(`\r${Math.min(i + 20, ids.length)} / ${ids.length} recordings`);
	}
	process.stdout.write("\n");
	return found;
}

await mkdir(cacheDir, { recursive: true });
const tier = z.array(MatchCase).parse(tierJson);
const traps = tier.flatMap((c) => {
	const category = LookalikeCategory.safeParse(c.category).data;
	return category !== undefined && c.provenance.source === "musicbrainz"
		? [{ ...c, category, provenance: c.provenance }]
		: [];
});
const recordings = await fetchRecordings(
	[...new Set(traps.map((c) => c.provenance.a.recording))].sort(),
);

const sets = traps.flatMap((c) => {
	const original = recordings.get(c.provenance.a.recording);
	if (original === undefined) return [];
	const elsewhere = (original.releases ?? [])
		.filter((release) => normalise(release.title) !== normalise(c.a.album ?? ""))
		.sort(
			(x, y) =>
				draw(`${original.id}|${x.title}|${x.date}`) - draw(`${original.id}|${y.title}|${y.date}`),
		);
	const release = elsewhere[0];
	if (release === undefined) return [];
	const track = release.media?.flatMap((medium) => medium.track ?? [])[0];
	const durationMs = track?.length ?? original.length ?? undefined;
	const date = release.date ? normaliseDate(release.date) : undefined;
	const source: SongInput = {
		title: track?.title ?? original.title,
		artists: c.a.artists,
		album: release.title,
		...(date ? { date } : {}),
		...(c.a.isrc ? { isrc: c.a.isrc } : {}),
		...(durationMs ? { durationMs } : {}),
	};
	const { a, b } = c.provenance;
	const swap = draw(`order|${a.recording}|${b.recording}|${c.category}`) < 0.5;
	return [
		CandidateSet.parse({
			category: c.category,
			source,
			candidates: swap ? [c.b, c.a] : [c.a, c.b],
			original: swap ? 1 : 0,
			trap: { a: a.recording, b: b.recording },
		}),
	];
});

// Parsing gives every song an empty `id`, which the tier's fixtures leave out.
const withoutEmptyId = (key: string, value: unknown) =>
	key === "id" && typeof value === "object" && value !== null && Object.keys(value).length === 0
		? undefined
		: value;
await writeFile(fixture, `${JSON.stringify(sets, withoutEmptyId, "\t")}\n`);
console.log(`wrote ${sets.length} candidate sets from ${traps.length} traps`);
