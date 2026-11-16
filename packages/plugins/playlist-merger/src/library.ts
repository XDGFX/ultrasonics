import type { PlaylistInput, SongInput } from "@ultrasonics/plugin-sdk";

/** mulberry32: a seeded generator, so a failure reproduces. */
export function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Words that real titles share often, so unrelated titles overlap as they do in a library. */
const commonWords = (
	"love you me the my in of night heart time baby girl home life world light dream down away " +
	"fire blue day dance gold run tonight forever again back free high lost wild young summer"
).split(" ");
/** Syllables that coin the rest of the words and the artists' names. */
const syllables = (
	"ka lo mi ra ten vor sa bel dun ix or pa shi tor ve lan ro ne ar gil fa mo tu zen el da rin " +
	"ko su an"
).split(" ");
const decorations = [" (Remastered 2011)", " - Radio Edit", " (feat. Kai)", " (Live)", " [Deluxe]"];

/**
 * Builds songs as a real library holds them: titles of one to four words, many of them common,
 * credits from a pool of artists, and lengths of about 3:45 ± 1 min.
 */
export function library(seed: number) {
	const random = seeded(seed);
	const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
	const coined = () => {
		const word = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(syllables)).join(
			"",
		);
		return word.length > 1 ? word : `${word}${pick(syllables)}`;
	};
	const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
	const artists = Array.from({ length: 1_500 }, () =>
		random() < 0.4 ? capital(coined()) : `${capital(coined())} ${capital(coined())}`,
	);
	/** A sum of uniforms, close enough to normal for lengths. */
	const normal = () => Array.from({ length: 6 }, random).reduce((sum, x) => sum + x, 0) - 3;
	let next = 0;

	const song = (): SongInput => {
		const words = Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
			random() < 0.45 ? pick(commonWords) : coined(),
		);
		const decorated = random() < 0.15 ? pick(decorations) : "";
		const credits = random() < 0.1 ? [pick(artists), pick(artists)] : [pick(artists)];
		return {
			title: `${words.map(capital).join(" ")}${decorated}`,
			artists: credits,
			// An untagged local file has no length.
			durationMs:
				random() < 0.01 ? undefined : Math.max(30_000, Math.round(225_000 + normal() * 60_000)),
			id: { deezer: String(next++) },
		};
	};

	/**
	 * The same recording as another service lists it: its own id, the length within a second, and
	 * sometimes the case or a remaster marker changed, so only weighing can find it.
	 */
	const elsewhere = ({ title, artists, durationMs }: SongInput): SongInput => ({
		title: random() < 0.2 ? title.toLowerCase() : random() < 0.1 ? `${title} (Remastered)` : title,
		artists,
		durationMs:
			typeof durationMs === "number"
				? durationMs + Math.round((random() * 2 - 1) * 1_000)
				: undefined,
		id: { spotify: String(next++) },
	});

	/**
	 * Two same-named playlists of `size` songs, the second holding `overlap` of the first's songs
	 * in a shuffled order and new songs for the rest.
	 */
	const pair = (size: number, overlap: number): [PlaylistInput, PlaylistInput] => {
		const first = Array.from({ length: size }, song);
		const shared = Math.round(size * overlap);
		const second = [
			...[...first]
				.sort(() => random() - 0.5)
				.slice(0, shared)
				.map(elsewhere),
			...Array.from({ length: size - shared }, song),
		].sort(() => random() - 0.5);
		return [
			{ name: "Library", id: {}, songs: first },
			{ name: "Library", id: {}, songs: second },
		];
	};

	return { pair };
}
