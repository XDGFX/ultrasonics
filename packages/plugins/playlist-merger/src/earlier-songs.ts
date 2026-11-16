import { lengthVetoMs, match } from "@ultrasonics/matcher";
import type { Song } from "@ultrasonics/plugin-sdk";

interface Timed {
	readonly song: Song;
	readonly length: number;
}

const idKey = (space: string, id: string) => `${space}\u0000${id}`;

/**
 * The songs of a group's earlier playlists, indexed so a later song is compared with as few as
 * possible. Neither shortcut can skip a pair `match` accepts: an id or location hit is a match
 * before any veto, and past `lengthVetoMs` apart nothing else is (spec #186, "Cost").
 */
export class EarlierSongs {
	readonly #ids = new Set<string>();
	readonly #locations = new Set<string>();
	readonly #byIsrc = new Map<string, Song[]>();
	/** Songs with a length, sorted by it once a playlist has been added. */
	readonly #timed: Timed[] = [];
	readonly #untimed: Song[] = [];

	/** Adds a whole playlist's songs, which later songs are then compared against. */
	addAll(songs: readonly Song[]): void {
		for (const song of songs) {
			for (const [space, id] of Object.entries(song.id)) this.#ids.add(idKey(space, id));
			if (song.location !== undefined) this.#locations.add(song.location);
			if (song.isrc !== undefined) {
				const sharing = this.#byIsrc.get(song.isrc);
				if (sharing) sharing.push(song);
				else this.#byIsrc.set(song.isrc, [song]);
			}
			if (song.durationMs === undefined) this.#untimed.push(song);
			else this.#timed.push({ song, length: song.durationMs });
		}
		this.#timed.sort((a, b) => a.length - b.length);
	}

	/** Whether `match` accepts `song` against any earlier song. */
	has(song: Song): boolean {
		if (Object.entries(song.id).some(([space, id]) => this.#ids.has(idKey(space, id)))) return true;
		if (song.location !== undefined && this.#locations.has(song.location)) return true;
		const matches = (other: Song) => match(song, other).matched;
		// A shared ISRC is the likeliest duplicate, so it is tried before the window.
		if (song.isrc !== undefined && this.#byIsrc.get(song.isrc)?.some(matches)) return true;
		return this.#untimed.some(matches) || this.#inWindow(song).some(matches);
	}

	/** The timed songs `song` could match on length, nearest first: all of them if it has none. */
	*#inWindow(song: Song): Generator<Song> {
		const length = song.durationMs;
		if (length === undefined) {
			for (const { song: other } of this.#timed) yield other;
			return;
		}
		const timed = this.#timed;
		let above = firstAtLeast(timed, length);
		let below = above - 1;
		const gap = (index: number) => Math.abs((timed[index]?.length ?? Infinity) - length);
		for (;;) {
			const left = below >= 0 && gap(below) <= lengthVetoMs ? gap(below) : Infinity;
			const right = above < timed.length && gap(above) <= lengthVetoMs ? gap(above) : Infinity;
			if (left === Infinity && right === Infinity) return;
			const next = left <= right ? timed[below--] : timed[above++];
			if (next) yield next.song;
		}
	}
}

/** The index of the first song at least `length` long, by binary search. */
function firstAtLeast(timed: readonly Timed[], length: number): number {
	let low = 0;
	let high = timed.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((timed[middle]?.length ?? length) < length) low = middle + 1;
		else high = middle;
	}
	return low;
}
