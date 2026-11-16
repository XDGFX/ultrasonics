import type { Log, Playlist, Song } from "@ultrasonics/plugin-sdk";
import { EarlierSongs } from "./earlier-songs.ts";

/** Names that differ only in case or surrounding spaces belong to one playlist (#186 decision 2). */
const nameKey = (name: string) => name.trim().toLocaleLowerCase("und");

/**
 * Replaces each group of same-named playlists with one, at the first one's position; a playlist
 * with no namesake passes through as it was.
 */
export function mergeByName(playlists: readonly Playlist[], log: Log): Playlist[] {
	const groups = Map.groupBy(playlists, (playlist) => nameKey(playlist.name));
	return [...groups.values()].map((group) => {
		const [first, ...later] = group;
		if (!first) throw new Error("A group always holds the playlist that started it.");
		return later.length === 0 ? first : mergeGroup(first, later, log);
	});
}

function mergeGroup(first: Playlist, later: readonly Playlist[], log: Log): Playlist {
	const group = [first, ...later];
	const earlier = new EarlierSongs();
	earlier.addAll(first.songs);
	const songs: Song[] = [...first.songs];
	for (const playlist of later) {
		// Compared with earlier playlists only, so a playlist's own repeats survive (story 6).
		songs.push(...playlist.songs.filter((song) => !earlier.has(song)));
		earlier.addAll(playlist.songs);
	}

	const songsIn = group.reduce((sum, playlist) => sum + playlist.songs.length, 0);
	log.info(
		`Merged "${first.name}" from ${group.length} playlists: ${songsIn} songs in, ${songsIn - songs.length} dropped as duplicates.`,
	);
	const description = group.find((playlist) => playlist.description !== undefined)?.description;
	return {
		name: first.name,
		...(description === undefined ? {} : { description }),
		id: unionIds(group, log),
		songs,
	};
}

/** Every id the group holds; where two differ under one key, the first wins (#186 decision 3). */
function unionIds(group: readonly Playlist[], log: Log): Record<string, string> {
	const ids: Record<string, string> = {};
	for (const playlist of group) {
		for (const [space, id] of Object.entries(playlist.id)) {
			const kept = ids[space];
			if (kept === undefined) ids[space] = id;
			else if (kept !== id)
				log.warn(
					`Playlists named "${playlist.name}" hold different ${space} ids, so the merged playlist keeps the first, ${kept}, and drops ${id}.`,
				);
		}
	}
	return ids;
}
