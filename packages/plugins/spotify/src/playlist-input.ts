import {
	type Log,
	nameFilter,
	type PlaylistInput,
	type SongDictInput,
} from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { type InputSettings, listEntries, playlistIdOf } from "./input-settings.ts";
import { type SpotifyClient, SpotifyError } from "./spotify-client.ts";
import { Entry, emptyTally, plural, songOf, tallyWarning, unescapeHtml } from "./track.ts";

const pageSize = "50";

/** Only what is emitted, so a page carries no more than it must. */
const itemFields =
	"next,items(is_local,item(type,id,name,artists(name),album(name,release_date),duration_ms,explicit,external_ids(isrc)))";

const Me = z.object({ id: z.string() });

const PlaylistDetails = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullish(),
});
type PlaylistDetails = z.output<typeof PlaylistDetails>;

const ListedPlaylist = PlaylistDetails.extend({
	collaborative: z.boolean().nullish(),
	owner: z.object({ id: z.string() }).nullish(),
});

/** A playlist the user can't read: deleted, someone else's private one, or only followed. */
const unreadable = (error: unknown): error is SpotifyError =>
	error instanceof SpotifyError && (error.status === 403 || error.status === 404);

/** Reads what the settings name, as playlists in Spotify's order (spec #136, "Reading"). */
export async function readPlaylists(
	client: SpotifyClient,
	settings: InputSettings,
	log: Log,
): Promise<SongDictInput> {
	switch (settings.source) {
		case "chosen":
			return { playlists: await readChosen(client, settings.playlists, log) };
		case "all":
			return { playlists: await readAll(client, settings.exclude ?? "", log) };
		case "liked":
			return { playlists: [await readLiked(client, settings.name, log)] };
	}
}

async function readChosen(
	client: SpotifyClient,
	value: string,
	log: Log,
): Promise<PlaylistInput[]> {
	const ids = [...new Set(listEntries(value).flatMap((entry) => playlistIdOf(entry) ?? []))];
	const playlists: PlaylistInput[] = [];
	for (const id of ids) {
		let details: PlaylistDetails;
		try {
			details = await client.get(PlaylistDetails, `/playlists/${id}`, {
				fields: "id,name,description",
			});
		} catch (error) {
			if (!unreadable(error)) throw error;
			log.warn(
				`Skipped the playlist ${id}: Spotify answered HTTP ${error.status}${because(error)}`,
			);
			continue;
		}
		const playlist = await readPlaylist(client, details, log);
		if (playlist) playlists.push(playlist);
	}
	return playlists;
}

async function readAll(client: SpotifyClient, exclude: string, log: Log): Promise<PlaylistInput[]> {
	const me = await client.get(Me, "/me");
	const excluded = nameFilter(exclude);
	const listed = (await client.all("/me/playlists", { limit: pageSize })).flatMap((raw) => {
		const parsed = ListedPlaylist.safeParse(raw);
		return parsed.success ? [parsed.data] : [];
	});
	const readable = listed.filter(
		(playlist) => playlist.owner?.id === me.id || playlist.collaborative === true,
	);
	const followed = listed.length - readable.length;
	log.info(
		`Left out ${plural(followed, "playlist", "playlists")} you only follow, which Spotify's development mode can't read`,
	);
	const playlists: PlaylistInput[] = [];
	for (const details of readable) {
		if (excluded(details.name.trim())) continue;
		const playlist = await readPlaylist(client, details, log);
		if (playlist) playlists.push(playlist);
	}
	return playlists;
}

async function readLiked(client: SpotifyClient, name: string, log: Log): Promise<PlaylistInput> {
	const saved = (await client.all("/me/tracks", { limit: pageSize })).map((raw) => {
		const addedAt = Date.parse(Entry.safeParse(raw).data?.added_at ?? "");
		return { raw, addedAt: Number.isNaN(addedAt) ? Number.NEGATIVE_INFINITY : addedAt };
	});
	// Spotify doesn't document this endpoint's order, so newest first is the plugin's own.
	saved.sort((a, b) => Math.sign(b.addedAt - a.addedAt) || 0);
	return playlistOf({ name, entries: saved.map((entry) => entry.raw) }, log);
}

/** One playlist's items, or `undefined` when they can't be read, which is warned about. */
async function readPlaylist(
	client: SpotifyClient,
	details: PlaylistDetails,
	log: Log,
): Promise<PlaylistInput | undefined> {
	let entries: unknown[];
	try {
		entries = await client.all(`/playlists/${details.id}/items`, {
			limit: pageSize,
			fields: itemFields,
		});
	} catch (error) {
		if (!unreadable(error)) throw error;
		log.warn(
			`Skipped the playlist "${details.name}": Spotify answered HTTP ${error.status}${because(error)}`,
		);
		return undefined;
	}
	const description = unescapeHtml(details.description ?? "").trim();
	return playlistOf(
		{
			name: details.name,
			...(description ? { description } : {}),
			id: { spotify: details.id },
			entries,
		},
		log,
	);
}

/** A playlist from its raw entries, logging what it read and its one summary of odd items. */
function playlistOf(
	playlist: Omit<PlaylistInput, "songs"> & { entries: unknown[] },
	log: Log,
): PlaylistInput {
	const { entries, ...rest } = playlist;
	const tally = emptyTally();
	const songs = entries.flatMap((raw) => songOf(raw, tally) ?? []);
	const warning = tallyWarning(rest.name, tally);
	if (warning) log.warn(warning);
	log.info(`Read "${rest.name}": ${plural(songs.length, "song", "songs")}`);
	return { ...rest, songs };
}

function because(error: SpotifyError): string {
	if (error.status === 404) return " (it doesn't exist, or was deleted)";
	return " (you can read only playlists you own or collaborate on)";
}
