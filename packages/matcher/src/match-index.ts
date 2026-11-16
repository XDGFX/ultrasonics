import type { Song } from "@ultrasonics/plugin-sdk";
import { lengthGapMs, lengthLevel, nonLatin, partScore, similarityLevels } from "./agreement.ts";
import { heaviestWeight } from "./fellegi-sunter.ts";
import { fitted } from "./fitted-weights.ts";
import { match } from "./match.ts";
import { artistNames, normalise, parseTitle } from "./normalise.ts";
import { byLength, containsWords, opens } from "./similarity.ts";
import { versionMarkersIn } from "./version-marker.ts";

/** A normalised name with what bounds its similarity to another. */
interface Name {
	readonly text: string;
	readonly symbolic: boolean;
	/** Its code points, sorted, so two names' shared letters are counted in one merge. */
	readonly letters: Uint32Array;
	readonly firstWord: string;
}

/** What blocking reads of a song, worked out once rather than for every pair. */
interface Entry {
	readonly song: Song;
	/** Where the song was added, so matches come back in that order. */
	readonly order: number;
	readonly markers: string;
	readonly title: Name;
	readonly titleIsLatin: boolean;
	readonly artists: readonly Name[];
	readonly artistsAreLatin: boolean;
}

const idKey = (space: string, id: string) => `${space}\u0000${id}`;

/** The `order` of a song being looked up, which has no place in the index. */
const unindexed = -1;

/**
 * Songs indexed so that `match` is asked only of the pairs it could accept, which finds exactly
 * what asking it of every pair finds (ADR-0032).
 */
export class MatchIndex {
	readonly #byKey = new Map<string, Entry[]>();
	/** Songs with a length, sorted by it. */
	readonly #timed: Entry[] = [];
	readonly #untimed: Entry[] = [];
	#size = 0;

	/** Adds songs, which every later query then searches. */
	add(songs: readonly Song[]): void {
		for (const song of songs) {
			const entry = entryOf(song, this.#size++);
			for (const key of hardKeys(song)) {
				const sharing = this.#byKey.get(key);
				if (sharing) sharing.push(entry);
				else this.#byKey.set(key, [entry]);
			}
			if (song.durationMs === undefined) this.#untimed.push(entry);
			else this.#timed.push(entry);
		}
		this.#timed.sort((a, b) => (a.song.durationMs ?? 0) - (b.song.durationMs ?? 0));
	}

	/** Every indexed song `match(song, it)` accepts, in the order they were added. */
	matchesOf(song: Song): Song[] {
		const found = new Map<number, Song>();
		for (const entry of this.#candidates(song)) {
			if (!found.has(entry.order) && match(song, entry.song).matched)
				found.set(entry.order, entry.song);
		}
		return [...found].sort(([a], [b]) => a - b).map(([, other]) => other);
	}

	/** Whether `match(song, it)` accepts any indexed song. */
	hasMatch(song: Song): boolean {
		for (const entry of this.#candidates(song)) if (match(song, entry.song).matched) return true;
		return false;
	}

	/** A superset of the songs `match` accepts against `song`; some may come more than once. */
	*#candidates(song: Song): Generator<Entry> {
		for (const key of hardKeys(song)) yield* this.#byKey.get(key) ?? [];
		const entry = entryOf(song, unindexed);
		const weighable = (other: Entry) => couldReachThreshold(entry, other);
		yield* this.#untimed.filter(weighable);
		const length = song.durationMs;
		if (length === undefined) {
			yield* this.#timed.filter(weighable);
			return;
		}
		const timed = this.#timed;
		for (let i = firstAtLeast(timed, length - fitted.lengthWindowMs); i < timed.length; i++) {
			const other = timed[i] as Entry;
			if ((other.song.durationMs ?? 0) > length + fitted.lengthWindowMs) return;
			if (weighable(other)) yield other;
		}
	}
}

/** The keys on which a shared value is a hard match: ids and the location, and the ISRC, which `match` still checks. */
function hardKeys(song: Song): string[] {
	return [
		...Object.entries(song.id).map(([space, id]) => idKey(space, id)),
		...(song.location === undefined ? [] : [idKey("location", song.location)]),
		...(song.isrc === undefined ? [] : [idKey("isrc", song.isrc)]),
	];
}

function nameOf(text: string): Name {
	const letters = Uint32Array.from(text, (letter) => letter.codePointAt(0) ?? 0).sort();
	const firstWord = text.split(" ").find((word) => word !== "") ?? "";
	return { text, symbolic: normalise(text) === "", letters, firstWord };
}

function entryOf(song: Song, order: number): Entry {
	return {
		song,
		order,
		markers: [...versionMarkersIn(song.title)].sort().join(),
		title: nameOf(parseTitle(song.title).core),
		titleIsLatin: !nonLatin.test(song.title),
		artists: artistNames(song.artists).map(nameOf),
		artistsAreLatin: !nonLatin.test(song.artists.join(" ")),
	};
}

/**
 * False only when `judge` would veto the pair or its weight can't reach the threshold, so it never
 * turns away a pair `match` would weigh to a match. Hard keys are found by key, not here.
 */
function couldReachThreshold(a: Entry, b: Entry): boolean {
	if (a.song.artists.length === 0 || b.song.artists.length === 0) return false;
	if (a.markers !== b.markers) return false;
	const length = lengthLevel(lengthGapMs(a.song, b.song));
	const title = levelsReached(titleSimilarityAtMost(a, b));
	const reaches = (artist: number) => reachesThreshold(length, title, artist);
	// The title alone turns most pairs away, before the dearer artist bound is worked out.
	return reaches(similarityLevels.length) && reaches(levelsReached(artistSimilarityAtMost(a, b)));
}

/** How many similarity levels `s` reaches, which is all `heaviestWeight` reads of a similarity. */
function levelsReached(s: number): number {
	let reached = 0;
	for (const [, least] of similarityLevels) if (least <= s) reached++;
	return reached;
}

/** The least similarity that reaches exactly `reached` levels; the levels run highest first. */
const reachingExactly = (reached: number) =>
	reached === 0 ? Number.NEGATIVE_INFINITY : (similarityLevels.at(-reached)?.[1] ?? 1);

const reached = new Map<string, boolean>();

/** Whether the heaviest weight bounds this far apart allow reaches the threshold, worked out once per kind. */
function reachesThreshold(length: string, title: number, artist: number): boolean {
	const key = `${length} ${title} ${artist}`;
	let reaches = reached.get(key);
	if (reaches === undefined) {
		const bounds = { title: reachingExactly(title), artist: reachingExactly(artist), length };
		reaches = heaviestWeight(fitted.weights, bounds) >= fitted.matchThreshold;
		reached.set(key, reaches);
	}
	return reaches;
}

/**
 * At least `similarity(a, b)`: the edit distance is at least the bag distance, the letters one
 * side has beyond the other (Bartolini et al., 2002). Symbolic names compare exactly, as in
 * `nameSimilarity`.
 */
function nameSimilarityAtMost(a: Name, b: Name): number {
	if (a.symbolic || b.symbolic) return Number(a.text === b.text);
	const [x, y] = [a.letters, b.letters];
	const longest = Math.max(x.length, y.length);
	if (longest === 0) return 1;
	let shared = 0;
	for (let i = 0, j = 0; i < x.length && j < y.length; ) {
		const [left, right] = [x[i] ?? 0, y[j] ?? 0];
		if (left === right) shared++;
		if (left <= right) i++;
		if (left >= right) j++;
	}
	return 1 - (longest - shared) / longest;
}

/** At least `titleSimilarity`; a non-Latin title is compared transliterated, so it isn't bounded. */
function titleSimilarityAtMost(a: Entry, b: Entry): number {
	if (!a.titleIsLatin || !b.titleIsLatin) return 1;
	const plain = nameSimilarityAtMost(a.title, b.title);
	// One title opens the other only if they start with the same word.
	const opening = a.title.firstWord === b.title.firstWord && opens(a.title.text, b.title.text);
	return Math.max(plain, opening ? partScore : 0);
}

/** At least `artistSimilarity`, bounding each name as `listSimilarity` compares them. */
function artistSimilarityAtMost(a: Entry, b: Entry): number {
	if (!a.artistsAreLatin || !b.artistsAreLatin) return 1;
	const [fewer, more] = byLength(a.artists, b.artists);
	if (fewer.length === 0) return 0;
	const found = fewer.map((name) =>
		Math.max(...more.map((other) => nameSimilarityAtMost(name, other))),
	);
	const listed = found.reduce((sum, s) => sum + s, 0) / fewer.length;
	const text = (names: readonly Name[]) => names.map((name) => name.text).join(" ");
	return Math.max(listed, containsWords(text(fewer), text(more)) ? partScore : 0);
}

/** The index of the first song at least `length` long, by binary search. */
function firstAtLeast(timed: readonly Entry[], length: number): number {
	let low = 0;
	let high = timed.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((timed[middle]?.song.durationMs ?? 0) < length) low = middle + 1;
		else high = middle;
	}
	return low;
}
