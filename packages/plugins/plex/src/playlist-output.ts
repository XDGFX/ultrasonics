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
): Promise<OutputResult> {
	const client = await PlexClient.connect(grant);
	const library = resolveLibrary(await client.libraries(), settings.library);
	log.info(`Writing to the Plex library "${library.title}" (section ${library.key})`);
	const existing = ordinaryAudioByTitle(await client.playlists());
	const target: Target = { client, library, log };

	const results: PlaylistResult[] = [];
	for (const [position, playlist] of playlists.entries()) {
		results.push(
			await writeOne(target, playlist, existing.get(playlist.name) ?? [], settings.existing).then(
				(result) => ({ ...result, playlist: position }) as PlaylistResult,
			),
		);
	}
	return { playlists: results };
}

/** Smart playlists and video or photo playlists can't take tracks, so they never count. */
function ordinaryAudioByTitle(playlists: PlexPlaylist[]): Map<string, PlexPlaylist[]> {
	const byTitle = new Map<string, PlexPlaylist[]>();
	for (const playlist of playlists) {
		if (playlist.smart || playlist.playlistType !== "audio") continue;
		byTitle.set(playlist.title, [...(byTitle.get(playlist.title) ?? []), playlist]);
	}
	return byTitle;
}

type Outcome = DistributiveOmit<PlaylistResult, "playlist">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

async function writeOne(
	target: Target,
	playlist: Playlist,
	sameTitle: PlexPlaylist[],
	existing: OutputSettings["existing"],
): Promise<Outcome> {
	const { log } = target;
	if (playlist.songs.length === 0) {
		return { status: "skipped", code: "empty", message: `"${playlist.name}" has no songs` };
	}
	try {
		const ratingKeys: string[] = [];
		const unmatched: number[] = [];
		for (const [position, song] of playlist.songs.entries()) {
			const ratingKey = await findTrack(target, song);
			if (ratingKey === undefined) unmatched.push(position);
			else ratingKeys.push(ratingKey);
		}
		const tally = `${ratingKeys.length} of ${playlist.songs.length} songs matched`;
		if (ratingKeys.length === 0) {
			const message = `Nothing in "${playlist.name}" matched a track in Plex, so it was not written`;
			log.warn(message);
			return { status: "skipped", code: "no-matches", message };
		}
		const [current, ...others] = sameTitle;
		if (others.length > 0) {
			const message = `${sameTitle.length} Plex playlists are called "${playlist.name}", so it was not written`;
			log.warn(message);
			return { status: "skipped", code: "ambiguous-playlist", message };
		}
		if (current === undefined) {
			await create(target.client, playlist.name, ratingKeys);
			log.info(`Created the Plex playlist "${playlist.name}": ${tally}`);
		} else if (existing === "append") {
			await append(target.client, current.ratingKey, ratingKeys);
			log.info(`Appended to the Plex playlist "${playlist.name}": ${tally}`);
		} else {
			await update(target.client, current.ratingKey, ratingKeys);
			log.info(`Updated the Plex playlist "${playlist.name}": ${tally}`);
		}
		return { status: "written", unmatched };
	} catch (error) {
		if (error instanceof PlexError && error.code === "invalid-credentials") throw error;
		const reason = error instanceof Error ? error.message : String(error);
		log.error(`Could not write "${playlist.name}" to Plex: ${reason}`);
		return { status: "failed", code: "service-error", message: reason };
	}
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

async function create(client: PlexClient, title: string, ratingKeys: string[]): Promise<void> {
	const [first = [], ...rest] = batches(ratingKeys);
	const playlistKey = await client.createPlaylist(title, first);
	for (const batch of rest) await client.addToPlaylist(playlistKey, batch);
}

/** Adds the tracks the playlist doesn't already hold, so a repeated sync adds nothing. */
async function append(client: PlexClient, playlistKey: string, ratingKeys: string[]) {
	const held = new Set((await client.playlistItems(playlistKey)).map((item) => item.ratingKey));
	const missing = ratingKeys.filter((ratingKey) => !held.has(ratingKey));
	for (const batch of batches(missing)) await client.addToPlaylist(playlistKey, batch);
}

/**
 * Adds what's missing, removes the rest, then moves items into source order: adding first means a
 * failure never leaves the playlist empty, and Plex won't add a track it already holds.
 */
async function update(client: PlexClient, playlistKey: string, ratingKeys: string[]) {
	const wantedSet = new Set(ratingKeys);
	const wanted = [...wantedSet];
	await append(client, playlistKey, wanted);

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
}
