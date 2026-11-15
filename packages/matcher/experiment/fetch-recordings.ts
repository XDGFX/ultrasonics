/**
 * Experiment for #132, not shipped. Fetches every recording in the CC0 tier from the MusicBrainz
 * search service, 20 MBIDs a request, and keeps what the experiment needs: each recording's ISRCs
 * and the releases it appears on (title, date, track title and length). Core data only (CC0).
 *
 *   bun experiment/fetch-recordings.ts
 *
 * Writes `experiment/recordings.json`. Responses are cached in the git-ignored
 * `musicbrainz-cache/`, shared with the CC0 builder's cache directory.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import tier from "../test/fixtures/match-dataset/musicbrainz.json";

const packageRoot = join(import.meta.dir, "..");
const cacheDir = join(packageRoot, "musicbrainz-cache");
const userAgent = "ultrasonics-match-dataset/0.1 ( https://github.com/XDGFX/ultrasonics )";

interface RawRecording {
	id: string;
	title: string;
	length?: number | null;
	isrcs?: string[];
	"first-release-date"?: string;
	releases?: {
		id: string;
		title: string;
		date?: string;
		status?: string;
		"release-group"?: { "primary-type"?: string; "secondary-types"?: string[] };
		media?: { track?: { title: string; length?: number | null; number?: string }[] }[];
	}[];
}

export interface RecordingFacts {
	id: string;
	title: string;
	lengthMs?: number;
	isrcs: string[];
	firstReleaseDate?: string;
	releases: {
		title: string;
		date?: string;
		status?: string;
		compilation: boolean;
		trackTitle?: string;
		trackLengthMs?: number;
	}[];
}

const sha1 = (text: string) => new Bun.CryptoHasher("sha1").update(text).digest("hex");

async function get(url: string): Promise<{ recordings: RawRecording[] }> {
	const file = join(cacheDir, `${sha1(url)}.json`);
	const cached = await readFile(file, "utf8").catch(() => undefined);
	if (cached !== undefined) return JSON.parse(cached);
	for (let attempt = 0; ; attempt++) {
		await Bun.sleep(1100);
		const response = await fetch(url, { headers: { "User-Agent": userAgent } }).catch(
			() => undefined,
		);
		if (response?.ok) {
			const body = await response.text();
			await writeFile(file, body);
			return JSON.parse(body);
		}
		if (attempt >= 5) throw new Error(`MusicBrainz gave ${response?.status} for ${url}`);
		await Bun.sleep(2000 * (attempt + 1));
	}
}

await mkdir(cacheDir, { recursive: true });
const ids = [
	...new Set(
		(tier as { provenance: { a: { recording: string }; b: { recording: string } } }[]).flatMap(
			(c) => [c.provenance.a.recording, c.provenance.b.recording],
		),
	),
].sort();

const facts: Record<string, RecordingFacts> = {};
for (let i = 0; i < ids.length; i += 20) {
	const batch = ids.slice(i, i + 20);
	const query = encodeURIComponent(batch.map((id) => `rid:${id}`).join(" OR "));
	const page = await get(`https://musicbrainz.org/ws/2/recording?query=${query}&limit=25&fmt=json`);
	for (const r of page.recordings) {
		if (!batch.includes(r.id)) continue;
		facts[r.id] = {
			id: r.id,
			title: r.title,
			lengthMs: r.length ?? undefined,
			isrcs: r.isrcs ?? [],
			firstReleaseDate: r["first-release-date"],
			releases: (r.releases ?? []).map((release) => {
				const track = release.media?.flatMap((m) => m.track ?? [])[0];
				return {
					title: release.title,
					date: release.date,
					status: release.status,
					compilation:
						release["release-group"]?.["secondary-types"]?.includes("Compilation") ?? false,
					trackTitle: track?.title,
					trackLengthMs: track?.length ?? undefined,
				};
			}),
		};
	}
	process.stdout.write(`\r${Math.min(i + 20, ids.length)} / ${ids.length}`);
}
await writeFile(join(import.meta.dir, "recordings.json"), `${JSON.stringify(facts)}\n`);
console.log(`\nwrote ${Object.keys(facts).length} recordings`);
