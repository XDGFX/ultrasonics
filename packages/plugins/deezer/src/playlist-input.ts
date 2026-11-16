import type { Log, PlaylistInput } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { type DeezerClient, DeezerError } from "./deezer-client.ts";
import { type InputSettings, listEntries, playlistIdOf } from "./input-settings.ts";
import { blankToAbsent, songOf } from "./track.ts";

/** v1's page size; it keeps a 1,000-song playlist to ten requests (spec #184, decision 3). */
const pageSize = "100";

const PlaylistDetails = z.object({
	id: z.union([z.number(), z.string()]),
	title: z.string(),
	description: z.string().nullish(),
});

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Reads the linked playlists, in the order given, each once (spec #184, "Reading"). */
export async function readPlaylists(
	client: DeezerClient,
	settings: InputSettings,
	log: Log,
): Promise<{ playlists: PlaylistInput[] }> {
	const ids = [
		...new Set(listEntries(settings.playlists).flatMap((entry) => playlistIdOf(entry) ?? [])),
	];
	const playlists: PlaylistInput[] = [];
	for (const id of ids) {
		try {
			playlists.push(await readPlaylist(client, id, log));
		} catch (error) {
			if (!(error instanceof DeezerError && error.code === "unavailable")) throw error;
			log.warn(
				`Skipped the playlist ${id}: Deezer has no public playlist there (it is private, or was deleted). ${error.message}`,
			);
		}
	}
	return { playlists };
}

async function readPlaylist(client: DeezerClient, id: string, log: Log): Promise<PlaylistInput> {
	const details = await client.get(PlaylistDetails, `/playlist/${id}`);
	const tracks = await client.all(`/playlist/${id}/tracks`, { limit: pageSize });
	let untitled = 0;
	const songs = tracks.flatMap((raw) => {
		const song = songOf(raw);
		if (!song) untitled += 1;
		return song ?? [];
	});
	const name = details.title;
	if (untitled > 0) {
		log.warn(`In "${name}", skipped ${plural(untitled, "song", "songs")} without a title`);
	}
	log.info(`Read "${name}": ${plural(songs.length, "song", "songs")}`);
	const description = blankToAbsent(details.description);
	return {
		name,
		...(description ? { description } : {}),
		id: { deezer: String(details.id) },
		songs,
	};
}
