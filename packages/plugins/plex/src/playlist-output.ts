import { bestMatch } from "@ultrasonics/matcher";
import {
	type Log,
	type OutputResult,
	type Playlist,
	type PlaylistResult,
	type Song,
	withMeta,
} from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { resolveLibrary } from "./library.ts";
import { type LinksLocation, PlaylistLinks, type SourceId, sourceId } from "./playlist-links.ts";
import {
	type Library,
	PlexClient,
	PlexError,
	type PlexGrant,
	type PlexPlaylist,
} from "./plex-client.ts";
import { idSpace, toSong } from "./track.ts";

/** Rating keys per write request, so a long playlist never makes an over-long URL. */
export const batchSize = 100;

/** Candidates asked of one search query. */
const searchLimit = 20;

/** The output's instance settings. There is no match threshold: the matcher owns that (#104). */
export const outputSettings = z.object({
	library: withMeta(z.string().optional(), {
		title: "Library",
		description:
			"The music library to write to, by title or section id. Leave blank to use the server's only music library.",
	}),
	existing: withMeta(z.enum(["append", "update"]).default("append"), {
		title: "Existing playlists",
		description: "Append adds the tracks a playlist doesn't hold yet. Update mirrors the source.",
		warning: "Update removes tracks from the Plex playlist that aren't in the source.",
	}),
});
type OutputSettings = z.output<typeof outputSettings>;

/** Everything one output call shares across its playlists. */
interface Target {
	client: PlexClient;
	library: Library;
	log: Log;
	destinations: Destinations;
}

/**
 * Writes each playlist to Plex inside its own error boundary (spec #114). It throws only when the
 * server can't be used at all: unreachable, a refused token, or a library that can't be resolved.
 */
export async function writePlaylists(
	grant: PlexGrant,
	settings: OutputSettings,
	playlists: Playlist[],
	log: Log,
	linksLocation: LinksLocation,
): Promise<OutputResult> {
	const client = await PlexClient.connect(grant);
	const library = resolveLibrary(await client.libraries(), settings.library);
	log.info(`Writing to the Plex library "${library.title}" (section ${library.key})`);
	const links = await PlaylistLinks.load(linksLocation, log);
	const destinations = new Destinations(await client.playlists(), links, log);
	const target: Target = { client, library, log, destinations };

	const results: PlaylistResult[] = [];
	for (const [position, playlist] of playlists.entries()) {
		results.push(
			await writeOne(target, playlist, settings.existing).then(
				(result) => ({ ...result, playlist: position }) as PlaylistResult,
			),
		);
	}
	return { playlists: results };
}

/** The Plex playlist a source playlist is written to: an existing one, a new one, or none. */
type Destination =
	| { kind: "existing"; ratingKey: string; title: string }
	| { kind: "create" }
	| { kind: "ambiguous"; count: number };

/**
 * Picks each source playlist's Plex playlist, by its link, else by its name, and links the two. A
 * Plex playlist linked to a source playlist, or written this run, is never taken by name for another.
 */
class Destinations {
	/** Ordinary audio playlists by rating key, with their titles, including those made this run. */
	readonly #titles = new Map<string, string>();
	readonly #claimed: Set<string>;
	readonly #links: PlaylistLinks;
	readonly #log: Log;

	constructor(playlists: PlexPlaylist[], links: PlaylistLinks, log: Log) {
		// Smart playlists and video or photo playlists can't take tracks, so they never count.
		for (const playlist of playlists) {
			if (!playlist.smart && playlist.playlistType === "audio") {
				this.#titles.set(playlist.ratingKey, playlist.title);
			}
		}
		this.#claimed = links.linked();
		this.#links = links;
		this.#log = log;
	}

	/** The Plex playlist for `playlist`, which is linked to it and taken for this run. */
	async claim(playlist: Playlist): Promise<Destination> {
		const source = sourceId(playlist);
		const linked = source && this.#links.get(source);
		if (source && linked !== undefined) {
			if (this.#titles.has(linked)) return this.#take(source, linked, playlist.name);
			this.#log.info(
				`"${playlist.name}" was linked to a Plex playlist that is gone, so it is found by name`,
			);
			this.#claimed.delete(linked);
			await this.#links.drop(source);
		}
		const sameTitle = [...this.#titles]
			.filter(([key, title]) => title === playlist.name && !this.#claimed.has(key))
			.map(([key]) => key);
		const [only, ...others] = sameTitle;
		if (others.length > 0) return { kind: "ambiguous", count: sameTitle.length };
		return only === undefined ? { kind: "create" } : this.#take(source, only, playlist.name);
	}

	/** Records a Plex playlist just created for `playlist`, warning when its title is now shared. */
	async created(playlist: Playlist, ratingKey: string): Promise<void> {
		this.#titles.set(ratingKey, playlist.name);
		await this.#take(sourceId(playlist), ratingKey, playlist.name);
		const sharing = [...this.#titles.values()].filter((title) => title === playlist.name).length;
		if (sharing > 1) {
			this.#log.warn(`${sharing} Plex playlists are now called "${playlist.name}"`);
		}
	}

	async #take(source: SourceId | undefined, ratingKey: string, name: string): Promise<Destination> {
		this.#claimed.add(ratingKey);
		if (source) await this.#links.set(source, ratingKey);
		return { kind: "existing", ratingKey, title: this.#titles.get(ratingKey) ?? name };
	}
}

type Outcome = DistributiveOmit<PlaylistResult, "playlist">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

async function writeOne(
	target: Target,
	playlist: Playlist,
	existing: OutputSettings["existing"],
): Promise<Outcome> {
	const { log } = target;
	if (playlist.songs.length === 0) {
		return { status: "skipped", code: "empty", message: `"${playlist.name}" has no songs` };
	}
	try {
		const matches: { position: number; ratingKey: string }[] = [];
		const unmatched: number[] = [];
		for (const [position, song] of playlist.songs.entries()) {
			const ratingKey = await findTrack(target, song);
			if (ratingKey === undefined) unmatched.push(position);
			else matches.push({ position, ratingKey });
		}
		// Plex holds a track once per playlist, so only a track's first match can be written.
		const ratingKeys = [...new Set(matches.map((match) => match.ratingKey))];
		if (ratingKeys.length === 0) {
			const message = `Nothing in "${playlist.name}" matched a track in Plex, so it was not written`;
			log.warn(message);
			return { status: "skipped", code: "no-matches", message };
		}
		const destination = await target.destinations.claim(playlist);
		if (destination.kind === "ambiguous") {
			const message = `${destination.count} Plex playlists are called "${playlist.name}", so it was not written`;
			log.warn(message);
			return { status: "skipped", code: "ambiguous-playlist", message };
		}
		let held: Set<string>;
		let verb: string;
		if (destination.kind === "create") {
			held = await create(target.client, playlist.name, ratingKeys, (ratingKey) =>
				target.destinations.created(playlist, ratingKey),
			);
			verb = "Created";
		} else if (existing === "append") {
			held = await append(target.client, destination.ratingKey, ratingKeys);
			verb = "Appended to";
		} else {
			held = await update(target.client, destination.ratingKey, ratingKeys);
			verb = "Updated";
		}

		const seen = new Set<string>();
		const repeated: number[] = [];
		const refused: number[] = [];
		for (const { position, ratingKey } of matches) {
			if (seen.has(ratingKey)) repeated.push(position);
			else if (!held.has(ratingKey)) refused.push(position);
			seen.add(ratingKey);
		}
		const written = matches.length - repeated.length - refused.length;
		// A link outlives a rename on either side, so the two titles can differ.
		const title = destination.kind === "create" ? playlist.name : destination.title;
		const from = title === playlist.name ? "" : ` from "${playlist.name}"`;
		log.info(
			`${verb} the Plex playlist "${title}"${from}: ${matches.length} of ${playlist.songs.length} songs matched, ${written} written`,
		);
		if (repeated.length > 0) {
			log.warn(
				`"${playlist.name}" repeats ${count(repeated.length, "song")}, and a Plex playlist holds each track once, so the repeats were not written`,
			);
		}
		if (refused.length > 0) {
			log.warn(`Plex did not add ${count(refused.length, "matched song")} to "${playlist.name}"`);
		}
		const notWritten = [...unmatched, ...repeated, ...refused].sort((a, b) => a - b);
		return { status: "written", unmatched: notWritten };
	} catch (error) {
		if (error instanceof PlexError && error.code === "invalid-credentials") throw error;
		const reason = error instanceof Error ? error.message : String(error);
		log.error(`Could not write "${playlist.name}" to Plex: ${reason}`);
		return { status: "failed", code: "service-error", message: reason };
	}
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The rating key of the track `song` is, or `undefined` when there is none in the library. */
async function findTrack(target: Target, song: Song): Promise<string | undefined> {
	const { client, log } = target;
	const own = song.id[idSpace(client.machineIdentifier)];
	try {
		if (own !== undefined && (await isLibraryTrack(target, own))) return own;
		const candidates = await search(target, song.title);
		const songs = candidates.flatMap((track) => {
			const candidate = toSong(track, client.machineIdentifier);
			return candidate ? [{ ratingKey: track.ratingKey, song: candidate }] : [];
		});
		const best = bestMatch(
			song,
			songs.map((candidate) => candidate.song),
		);
		return best === undefined ? undefined : songs[best.index]?.ratingKey;
	} catch (error) {
		// A search Plex rejects is one odd title, never an expired token (must-still-work #6).
		if (error instanceof PlexError && error.code !== "invalid-credentials") {
			log.debug(`Plex could not search for "${song.title}": ${error.message}`);
			return undefined;
		}
		throw error;
	}
}

/** Whether `ratingKey` is a track in the resolved library; a failed lookup falls through to search. */
async function isLibraryTrack(target: Target, ratingKey: string): Promise<boolean> {
	try {
		const item = await target.client.item(ratingKey);
		return item?.type === "track" && item.librarySectionID === target.library.key;
	} catch (error) {
		if (error instanceof PlexError && error.code !== "invalid-credentials") {
			target.log.debug(`Plex could not look up the track ${ratingKey}: ${error.message}`);
			return false;
		}
		throw error;
	}
}

/**
 * Searches by title, then cut before a bracket, dash or colon, then that cut without its quotes,
 * stopping at the first that finds anything: Plex's search tells ' from ’.
 */
async function search(target: Target, title: string) {
	const { client, library } = target;
	const cut = title.split(/[([{\-‐–—:]/)[0]?.trim() ?? "";
	const unquoted = cut
		.replace(/['‘’]\p{L}*/gu, "")
		.replace(/["“”]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const queries = [...new Set([title, cut, unquoted])].filter((query) => query !== "");
	let found: Awaited<ReturnType<typeof client.searchTracks>> = [];
	for (const query of queries) {
		found = await client.searchTracks(library.key, query, searchLimit);
		if (found.length > 0) break;
	}
	return found;
}

function batches(ratingKeys: string[]): string[][] {
	const result: string[][] = [];
	for (let start = 0; start < ratingKeys.length; start += batchSize) {
		result.push(ratingKeys.slice(start, start + batchSize));
	}
	return result;
}

/** The rating keys a playlist holds. Plex answers a refused add with a 200, so each write re-reads. */
async function heldBy(client: PlexClient, playlistKey: string): Promise<Set<string>> {
	return new Set((await client.playlistItems(playlistKey)).map((item) => item.ratingKey));
}

/**
 * Creates the playlist from `ratingKeys`, distinct, and answers what it holds. `onCreated` hears
 * of it before the rest is added, so a failed add still leaves the new playlist known.
 */
async function create(
	client: PlexClient,
	title: string,
	ratingKeys: string[],
	onCreated: (playlistKey: string) => Promise<void>,
): Promise<Set<string>> {
	const [first = [], ...rest] = batches(ratingKeys);
	const playlistKey = await client.createPlaylist(title, first);
	await onCreated(playlistKey);
	for (const batch of rest) await client.addToPlaylist(playlistKey, batch);
	return heldBy(client, playlistKey);
}

/**
 * Adds the tracks of `ratingKeys`, distinct, that the playlist doesn't already hold, so a repeated
 * sync adds nothing, and answers what it holds.
 */
async function append(
	client: PlexClient,
	playlistKey: string,
	ratingKeys: string[],
): Promise<Set<string>> {
	const before = await heldBy(client, playlistKey);
	const missing = ratingKeys.filter((ratingKey) => !before.has(ratingKey));
	if (missing.length === 0) return before;
	for (const batch of batches(missing)) await client.addToPlaylist(playlistKey, batch);
	return heldBy(client, playlistKey);
}

/**
 * Adds what's missing, removes the rest, then moves items into source order: adding first means a
 * failure never leaves the playlist empty, and Plex won't add a track it already holds. `wanted`
 * must be distinct; the playlist ends up holding exactly it, or this throws.
 */
async function update(
	client: PlexClient,
	playlistKey: string,
	wanted: string[],
): Promise<Set<string>> {
	const wantedSet = new Set(wanted);
	const before = await heldBy(client, playlistKey);
	const missingBefore = wanted.filter((ratingKey) => !before.has(ratingKey));
	for (const batch of batches(missingBefore)) await client.addToPlaylist(playlistKey, batch);

	const kept = new Map<string, string>();
	const extra: string[] = [];
	for (const item of await client.playlistItems(playlistKey)) {
		if (item.playlistItemID === undefined) {
			throw new PlexError("service-error", "Plex listed a playlist item with no playlistItemID");
		}
		if (wantedSet.has(item.ratingKey) && !kept.has(item.ratingKey)) {
			kept.set(item.ratingKey, item.playlistItemID);
		} else {
			extra.push(item.playlistItemID);
		}
	}
	const missing = wanted.filter((ratingKey) => !kept.has(ratingKey));
	if (missing.length > 0) {
		throw new PlexError("service-error", `Plex did not add the tracks ${missing.join(", ")}`);
	}
	for (const itemId of extra) await client.removeFromPlaylist(playlistKey, itemId);

	const order = [...kept.keys()];
	for (const [position, ratingKey] of wanted.entries()) {
		const itemId = kept.get(ratingKey);
		if (order[position] === ratingKey || itemId === undefined) continue;
		const previous = wanted[position - 1];
		await client.moveInPlaylist(playlistKey, itemId, previous && kept.get(previous));
		order.splice(order.indexOf(ratingKey), 1);
		order.splice(position, 0, ratingKey);
	}
	return wantedSet;
}
