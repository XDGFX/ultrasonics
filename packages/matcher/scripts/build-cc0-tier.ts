/**
 * Builds the CC0 tier of the match dataset from MusicBrainz core data (spec #117, "The CC0 tier").
 *
 *   bun run build-cc0-tier [--seed 119] [--positives 1050] [--per-trap 125]
 *
 * It reads the MusicBrainz web service with a contact User-Agent, starting at most one request a
 * second, and caches every response in the git-ignored `musicbrainz-cache/`, so an interrupted
 * run resumes where it stopped. A cold run takes about two hours.
 *
 * - Sampling: digital releases with a Spotify URL link, stratified by the decade their release
 *   group first came out and by language, which brings in non-Latin scripts; songs with several
 *   artists come with them. Up to five tracks with an ISRC are taken from each release.
 * - Positives: one recording on two releases, so both sides share its ISRC. A remaster marker on
 *   one side only makes it a remaster positive.
 * - Edit, remix, re-recording and live traps: recordings disambiguated as one, paired with the
 *   recording their `edit` or `remix` link points to, or else with the same artist's plain
 *   recording of their work. Covers: that work recorded by another artist.
 * - Same-title traps: a sampled recording against one of the same title by another artist and of
 *   another work, then studio recordings of two distinct works sharing a common title.
 * - Four workers race to fill each quota, so two runs, even from a full cache, can differ in a
 *   few cases at a quota's edge. The sample itself is fixed by the seed.
 * - Only core data is kept: title, artist credit, length, ISRC, release title and date, MBIDs.
 *   Tags, ratings and annotations are CC BY-NC-SA and are never requested.
 *
 * Cases marked bad in `test/fixtures/match-dataset/spot-check.json` are left out, so a hand
 * spot-check survives a rebuild.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { normaliseDate, normaliseIsrc } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import {
	isPositive,
	MatchCase,
	type MatchCaseInput,
	oneSideRemastered,
	type TrapCategory,
	trapCategories,
} from "../src/match-case.ts";

const packageRoot = join(import.meta.dir, "..");
const cacheDir = join(packageRoot, "musicbrainz-cache");
const fixtureDir = join(packageRoot, "test/fixtures/match-dataset");
const userAgent = "ultrasonics-match-dataset/0.1 ( https://github.com/XDGFX/ultrasonics )";

const { values: args } = parseArgs({
	options: {
		seed: { type: "string", default: "119" },
		positives: { type: "string", default: "1050" },
		"per-trap": { type: "string", default: "125" },
	},
});
const positiveQuota = Number(args.positives);
const trapQuota = Number(args["per-trap"]);

// --- The web service --------------------------------------------------------------------------

const ArtistCredit = z.object({ name: z.string(), artist: z.object({ id: z.string() }) });
type ArtistCredit = z.output<typeof ArtistCredit>;

const Recording = z.object({
	id: z.string(),
	title: z.string(),
	length: z.number().nullish(),
	disambiguation: z.string().nullish(),
	isrcs: z.array(z.string()).optional(),
	"artist-credit": z.array(ArtistCredit).optional(),
	get releases() {
		return z.array(Release).optional();
	},
	get relations() {
		return z.array(Relation).optional();
	},
});
type Recording = z.output<typeof Recording>;

const Track = z.object({
	title: z.string(),
	length: z.number().nullish(),
	"artist-credit": z.array(ArtistCredit).optional(),
	get recording() {
		return Recording.optional();
	},
});
type Track = z.output<typeof Track>;

const Release = z.object({
	id: z.string(),
	title: z.string(),
	date: z.string().nullish(),
	status: z.string().nullish(),
	media: z
		.array(
			z.object({
				format: z.string().nullish(),
				track: z.array(Track).optional(),
				tracks: z.array(Track).optional(),
			}),
		)
		.optional(),
	get relations() {
		return z.array(Relation).optional();
	},
});
type Release = z.output<typeof Release>;

const Relation = z.object({
	type: z.string(),
	direction: z.enum(["forward", "backward"]),
	attributes: z.array(z.string()),
	recording: Recording.optional(),
	work: z.object({ id: z.string(), title: z.string() }).optional(),
	url: z.object({ resource: z.string() }).optional(),
});

const WorkLookup = z.object({ relations: z.array(Relation).optional() });
const SearchCount = z.object({ count: z.number().optional() });
const RecordingPage = z.object({ recordings: z.array(Recording).optional() });
const ReleasePage = z.object({ releases: z.array(Release).optional() });
const WorkPage = z.object({
	works: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
});

let nextStart = 0;

/** Spaces request starts 1.1 s apart without waiting on slow responses, so workers can overlap. */
async function rateSlot(): Promise<void> {
	const now = Date.now();
	const start = Math.max(now, nextStart);
	nextStart = start + 1100;
	if (start > now) await Bun.sleep(start - now);
}

const sha1 = (text: string) => new Bun.CryptoHasher("sha1").update(text).digest("hex");

/** A response parsed by `schema`, or `undefined` when MusicBrainz has nothing at that path. */
async function get<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S> | undefined> {
	const url = `https://musicbrainz.org/ws/2/${path}${path.includes("?") ? "&" : "?"}fmt=json`;
	const file = join(cacheDir, `${sha1(url)}.json`);
	const cached = await readFile(file, "utf8").catch(() => undefined);
	if (cached !== undefined) return schema.parse(JSON.parse(cached));
	for (let attempt = 0; ; attempt++) {
		await rateSlot();
		// A dropped connection never settles on its own, so a timeout sends it to the retry below.
		const signal = AbortSignal.timeout(30_000);
		const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal }).catch(
			() => undefined,
		);
		if (response && response.status >= 400 && response.status < 500 && response.status !== 429) {
			console.warn(`Skipping ${url}: ${response.status}`);
			return undefined;
		}
		const body = response?.ok ? await response.text().catch(() => undefined) : undefined;
		if (body !== undefined) {
			await writeFile(file, body);
			return schema.parse(JSON.parse(body));
		}
		if (attempt >= 5) throw new Error(`MusicBrainz gave ${response?.status} for ${url}`);
		await Bun.sleep(2000 * (attempt + 1));
	}
}

const lookupRecording = (id: string) =>
	get(`recording/${id}?inc=artist-credits+isrcs+work-rels+recording-rels`, Recording);
const lookupWork = async (id: string) =>
	(await get(`work/${id}?inc=recording-rels+artist-credits`, WorkLookup))?.relations ?? [];

/** A fraction drawn from the seed and the query, so workers' order never changes the sample. */
const draw = (query: string, round: number) =>
	Number.parseInt(sha1(`${args.seed}|${query}|${round}`).slice(0, 8), 16) / 2 ** 32;

/** A random page of the first 500 results, the most the search service will page through. */
async function search<S extends z.ZodType>(
	entity: "recording" | "release",
	schema: S,
	query: string,
	limit: number,
	round: number,
) {
	const encoded = encodeURIComponent(query);
	const first = await get(`${entity}?query=${encoded}&limit=1`, SearchCount);
	const offset = Math.floor(
		draw(query, round) * Math.max(0, Math.min(first?.count ?? 0, 500) - limit),
	);
	return get(`${entity}?query=${encoded}&limit=${limit}&offset=${offset}`, schema);
}

const searchRecordings = async (query: string, limit = 50, round = 0) =>
	(await search("recording", RecordingPage, query, limit, round))?.recordings ?? [];

/** Fetches recordings with their releases in batches of 20, one search request a batch. */
async function recordingsById(ids: readonly string[]): Promise<Map<string, Recording>> {
	const found = new Map<string, Recording>();
	const unique = [...new Set(ids)].sort();
	for (let i = 0; i < unique.length; i += 20) {
		const batch = unique.slice(i, i + 20);
		const query = encodeURIComponent(batch.map((id) => `rid:${id}`).join(" OR "));
		const page = await get(`recording?query=${query}&limit=25`, RecordingPage);
		for (const recording of page?.recordings ?? []) found.set(recording.id, recording);
	}
	return found;
}

// --- Turning MusicBrainz data into song dicts ---------------------------------------------------

const shareArtist = (a: ArtistCredit[] = [], b: ArtistCredit[] = []) => {
	const ids = new Set(a.map((c) => c.artist.id));
	return b.some((c) => ids.has(c.artist.id));
};

function trackOf(release: Release): Track | undefined {
	const medium = release.media?.find((m) => (m.tracks ?? m.track)?.length);
	return (medium?.tracks ?? medium?.track)?.[0];
}

type SongFields = MatchCaseInput["a"];

function songOf(
	recording: Recording,
	release: Release | undefined,
	track = release && trackOf(release),
): SongFields {
	const credit = track?.["artist-credit"] ?? recording["artist-credit"] ?? [];
	return {
		title: track?.title ?? recording.title,
		artists: credit.map((c) => c.name),
		album: release?.title,
		date: release?.date ? normaliseDate(release.date) : undefined,
		isrc: recording.isrcs?.map(normaliseIsrc).find(Boolean),
		durationMs: track?.length ?? recording.length ?? undefined,
	};
}

/** The earliest dated official release, the one a service most likely shows. */
function firstRelease(recording: Recording): Release | undefined {
	const releases = recording.releases ?? [];
	const dated = releases
		.filter((r) => r.date)
		.sort((x, y) => String(x.date).localeCompare(String(y.date)));
	return dated.find((r) => r.status === "Official") ?? dated[0] ?? releases[0];
}

const side = (recording: Recording) => ({ isrc: recording.isrcs?.[0], recording: recording.id });

// --- Building cases ----------------------------------------------------------------------------

const cases: MatchCaseInput[] = [];
const seen = new Set<string>();
const trapCounts = Object.fromEntries(trapCategories.map((c) => [c, 0])) as Record<
	TrapCategory,
	number
>;
let positives = 0;
const trapOpen = (category: TrapCategory) => trapCounts[category] < trapQuota;

const SpotCheck = z.array(
	z.object({
		a: z.string(),
		b: z.string(),
		verdict: z.enum(["good", "bad"]),
		note: z.string().optional(),
	}),
);
const spotCheckText = await readFile(join(fixtureDir, "spot-check.json"), "utf8").catch(() => "[]");
const spotCheck = SpotCheck.parse(JSON.parse(spotCheckText));
const dropped = new Set(spotCheck.filter((c) => c.verdict === "bad").map((c) => `${c.a}|${c.b}`));

function add(candidate: MatchCaseInput): boolean {
	if (candidate.provenance.source !== "musicbrainz") return false;
	const key = `${candidate.provenance.a.recording}|${candidate.provenance.b.recording}`;
	if (seen.has(key) || dropped.has(key) || !MatchCase.safeParse(candidate).success) return false;
	if (isPositive(candidate.category)) {
		if (positives >= positiveQuota) return false;
		positives++;
	} else {
		if (!trapOpen(candidate.category)) return false;
		trapCounts[candidate.category]++;
	}
	seen.add(key);
	cases.push(candidate);
	return true;
}

function trap(category: TrapCategory, a: SongFields, base: Recording, variant: Recording): boolean {
	if (!variant.isrcs?.length || variant.isrcs.some((i) => base.isrcs?.includes(i))) return false;
	return add({
		a,
		b: songOf(variant, firstRelease(variant)),
		label: "no-match",
		category,
		provenance: { source: "musicbrainz", a: side(base), b: side(variant) },
	});
}

const versionWords =
	/\b(live|remix|mix|edit|version|demo|instrumental|acoustic|karaoke|re-?record)/i;
const versionText = (r: Recording) => `${r.title} ${r.disambiguation ?? ""}`;

interface Sampled {
	recording: Recording;
	song: SongFields;
}

/** Takes up to five tracks with an ISRC from a Spotify-linked release, as positives. */
async function sampleRelease(id: string): Promise<{ sampled: Sampled[]; added: number }> {
	const release = await get(`release/${id}?inc=url-rels+recordings+isrcs+artist-credits`, Release);
	if (!release?.relations?.some((r) => r.url?.resource.includes("open.spotify.com"))) {
		return { sampled: [], added: 0 };
	}
	const tracks = (release.media ?? [])
		.flatMap((m) => m.tracks ?? [])
		.filter((t) => t.recording?.isrcs?.length);
	const step = Math.max(1, Math.floor(tracks.length / 5));
	const picked = [0, 1, 2, 3, 4].flatMap((i) => tracks.slice(i * step, i * step + 1));
	const found = await recordingsById(picked.flatMap((t) => (t.recording ? [t.recording.id] : [])));
	const sampled: Sampled[] = [];
	let added = 0;
	for (const track of new Set(picked)) {
		const hit = track.recording && found.get(track.recording.id);
		if (!hit) continue;
		// The release lookup's ISRCs belong to this recording; the search's may be trimmed.
		const recording = { ...hit, isrcs: track.recording?.isrcs };
		const song = songOf(recording, release, track);
		sampled.push({ recording, song });
		const other =
			recording.releases?.find((r) => r.id !== release.id && r.title !== release.title) ??
			recording.releases?.find((r) => r.id !== release.id && r.date && r.date !== release.date);
		if (!other) continue;
		const b = songOf(recording, other);
		const provenance = { source: "musicbrainz" as const, a: side(recording), b: side(recording) };
		const category = oneSideRemastered(song, b) ? "remaster" : "plain";
		if (add({ a: song, b, label: "match", category, provenance })) added++;
	}
	return { sampled, added };
}

/** Pairs a sampled recording with one of the same title by another artist, of another work. */
async function sameTitle({ recording: sampled, song }: Sampled): Promise<void> {
	if (!trapOpen("same-title") || sampled.title.length < 3) return;
	const looked = await lookupRecording(sampled.id);
	if (!looked) return;
	const base = { ...looked, isrcs: sampled.isrcs };
	const workId = base.relations?.find((r) => r.type === "performance")?.work?.id;
	if (!workId) return;
	const title = base.title.replaceAll('"', "");
	const other = (await searchRecordings(`recording:"${title}" AND isrc:*`, 25)).find(
		(r) =>
			r.title.toLowerCase() === base.title.toLowerCase() &&
			!shareArtist(base["artist-credit"], r["artist-credit"]),
	);
	if (!other) return;
	const work = (await lookupRecording(other.id))?.relations?.find(
		(r) => r.type === "performance",
	)?.work;
	if (work && work.id !== workId) trap("same-title", song, base, other);
}

/** Pairs studio recordings of two distinct works that share a title, by different artists. */
async function sameTitleWorks(rawTitle: string, pairs: number, limit: number): Promise<void> {
	if (!trapOpen("same-title") || rawTitle.length < 3) return;
	const title = rawTitle.toLowerCase();
	const query = encodeURIComponent(`work:"${rawTitle.replaceAll('"', "")}"`);
	const works = (await get(`work?query=${query}&limit=${limit}`, WorkPage))?.works ?? [];
	const recordingIds: string[] = [];
	for (const work of works.filter((w) => w.title.toLowerCase() === title).slice(0, 2 * pairs)) {
		const studio = (await lookupWork(work.id)).find(
			(r) => r.recording && !r.attributes.includes("live") && !r.attributes.includes("cover"),
		)?.recording;
		if (studio) recordingIds.push(studio.id);
	}
	const found = await recordingsById(recordingIds);
	for (let i = 0; i + 1 < recordingIds.length; i += 2) {
		const a = found.get(recordingIds[i] as string);
		const b = found.get(recordingIds[i + 1] as string);
		if (!a?.isrcs?.length || !b || shareArtist(a["artist-credit"], b["artist-credit"])) continue;
		trap("same-title", songOf(a, firstRelease(a)), a, b);
	}
}

/** Titles many unrelated songs share, the case a same-title trap exists for. */
const commonTitles = [
	"Home",
	"Hello",
	"Stay",
	"Forever",
	"Angel",
	"Crazy",
	"Smile",
	"Alive",
	"Fire",
	"Dreams",
	"Together",
	"Rain",
	"Heaven",
	"Tonight",
	"Hold On",
	"Without You",
	"Breathe",
	"Falling",
	"Summer",
	"Paradise",
	"Shine",
	"Runaway",
	"Hurricane",
	"Gravity",
	"Wonderful",
	"Freedom",
	"Lullaby",
	"Amor",
	"Te amo",
	"Amore",
	"Liebe",
	"Mama",
	"Habibi",
	"Sakura",
	"Paradis",
	"Corazón",
];

type Pair = [category: TrapCategory, variant: string, original: string];

/**
 * Starts from recordings disambiguated as a variant and walks back to the original each varies.
 * The work lookup on the way also gives covers: the original's work recorded by another artist.
 */
async function topUp(category: TrapCategory, query: string): Promise<void> {
	for (let round = 0; round < 40 && (trapOpen(category) || trapOpen("cover")); round++) {
		const pairs: Pair[] = [];
		for (const variant of await searchRecordings(`${query} AND isrc:*`, 25, round)) {
			const detail = await lookupRecording(variant.id);
			if (!detail) continue;
			const forward = detail.relations?.find(
				(r) => r.direction === "forward" && r.type === category && r.recording,
			)?.recording;
			if (forward) {
				pairs.push([category, variant.id, forward.id]);
				continue;
			}
			const work = detail.relations?.find((r) => r.type === "performance")?.work;
			if (!work) continue;
			const siblings = await lookupWork(work.id);
			const original = siblings.find(
				(r) =>
					r.recording &&
					r.recording.id !== variant.id &&
					!r.attributes.includes("live") &&
					shareArtist(detail["artist-credit"], r.recording["artist-credit"]) &&
					!versionWords.test(versionText(r.recording)),
			)?.recording;
			if (!original) continue;
			pairs.push([category, variant.id, original.id]);
			const covers = siblings.filter(
				(r) =>
					r.recording &&
					!r.attributes.includes("live") &&
					!shareArtist(original["artist-credit"], r.recording["artist-credit"]),
			);
			for (const cover of covers.slice(0, 3)) {
				if (cover.recording) pairs.push(["cover", cover.recording.id, original.id]);
			}
		}
		const found = await recordingsById(pairs.flatMap(([, v, o]) => [v, o]));
		const covered = new Set<string>();
		for (const [kind, variantId, originalId] of pairs) {
			const variant = found.get(variantId);
			const original = found.get(originalId);
			if (!variant || !original?.isrcs?.length) continue;
			if (kind === "cover" && covered.has(originalId)) continue;
			const song = songOf(original, firstRelease(original));
			if (trap(kind, song, original, variant) && kind === "cover") covered.add(originalId);
		}
		console.log(`Top-up ${category} round ${round}: traps ${JSON.stringify(trapCounts)}`);
	}
}

/** Runs tasks four at a time; the shared rate slot still keeps starts a second apart. */
async function pool<T>(items: readonly T[], task: (item: T) => Promise<void>): Promise<void> {
	const queue = [...items];
	const worker = async () => {
		for (let item = queue.shift(); item !== undefined; item = queue.shift()) await task(item);
	};
	await Promise.all(Array.from({ length: 4 }, worker));
}

const decades = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
// Language stands in for region: release search has no artist area, and it reaches non-Latin scripts.
const languages = [
	...["eng", "spa", "por", "fra", "deu", "swe", "ita"],
	...["jpn", "kor", "zho", "rus", "ell", "heb", "hin", "ara", "tha"],
];
const strata = decades.flatMap((decade) => languages.map((lang) => ({ decade, lang })));
const bases: Sampled[] = [];

await mkdir(cacheDir, { recursive: true });

// Each round shares what is left among the strata that gave something in the round before.
let active = strata;
for (let round = 0; round < 6 && positives < positiveQuota && active.length; round++) {
	const share = Math.ceil((positiveQuota - positives) / active.length);
	const productive: typeof strata = [];
	await pool(active, async (stratum) => {
		const { decade, lang } = stratum;
		const query = `firstreleasedate:[${decade} TO ${decade + 9}] AND lang:${lang} AND format:"Digital Media"`;
		const releases = (await search("release", ReleasePage, query, 25, round))?.releases ?? [];
		let taken = 0;
		for (const release of releases) {
			if (taken >= share || positives >= positiveQuota) break;
			const { sampled, added } = await sampleRelease(release.id);
			taken += added;
			bases.push(...sampled.slice(0, 1));
		}
		if (taken > 0) productive.push(stratum);
	});
	active = productive;
	console.log(`Round ${round}: ${positives} positives from ${active.length} strata`);
}

bases.sort((x, y) => sha1(x.recording.id).localeCompare(sha1(y.recording.id)));
await pool(
	[
		["edit", 'comment:"radio edit"'],
		["remix", "comment:remix"],
		["re-recording", 'comment:"re-recording"'],
		["live", "comment:live"],
	] as const,
	([category, query]) => topUp(category, query),
);
console.log("Topped up:", trapCounts);
await pool(bases, sameTitle);
// A same-title search seldom finds another work, so works sharing a common title fill the rest.
await pool(commonTitles, async (title) => {
	await sameTitleWorks(title, 4, 25);
	console.log(`Same-title after "${title}": ${trapCounts["same-title"]}`);
});
await pool(bases, (base) => sameTitleWorks(base.recording.title, 1, 10));

const order = (c: MatchCaseInput) =>
	c.provenance.source === "musicbrainz"
		? `${c.category}|${c.provenance.a.recording}|${c.provenance.b.recording}`
		: c.category;
cases.sort((x, y) => order(x).localeCompare(order(y)));
await writeFile(join(fixtureDir, "musicbrainz.json"), `${JSON.stringify(cases, null, "\t")}\n`);
console.log(`Wrote ${cases.length} cases: ${positives} positives`, trapCounts);
