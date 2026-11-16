import {
	type Log,
	nameFilter,
	type PlaylistInput,
	type SongDictInput,
	type SongInput,
	withMeta,
} from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import {
	PlexClient,
	PlexError,
	type PlexGrant,
	type PlexPlaylist,
	type PlexTrack,
} from "./plex-client.ts";
import { idSpace, toSong } from "./track.ts";

/** The shared name filter's help (#177), kept to plain text: the settings form renders no Markdown. */
const patternHelp =
	"Comma-separated names. * matches anything, ? one character. Case doesn't matter.";

const all = withMeta(
	z.object({
		source: z.literal("all"),
		exclude: withMeta(z.string().optional(), {
			title: "leave out",
			description: patternHelp,
			placeholder: "All Music, Recently*",
		}),
	}),
	{
		title: "all my playlists",
		description: "Every audio playlist on the server, smart playlists included.",
	},
);

const chosen = withMeta(
	z.object({
		source: z.literal("chosen"),
		playlists: withMeta(
			z
				.string()
				.trim()
				.refine((value) => entries(value).length > 0, "Name at least one playlist"),
			{ title: "playlists", description: patternHelp, placeholder: "Gym*, Road trip" },
		),
	}),
	{
		title: "playlists i choose",
		description: "The playlists these names match, in the order you list them.",
	},
);

/**
 * What the `inputs` component reads (spec #182, "Instance settings"). `all` comes first because a
 * new slot takes the first variant's defaults, and only `all` is valid before anything is typed.
 */
export const inputSettings = z.discriminatedUnion("source", [all, chosen]);
export type InputSettings = z.output<typeof inputSettings>;

/** A comma-separated list's patterns, trimmed, blanks dropped, as `nameFilter` splits them. */
function entries(value: string): string[] {
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "");
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Reads the audio playlists the settings pick, in the order they pick them (spec #182, "Reading"). */
export async function readPlaylists(
	grant: PlexGrant,
	settings: InputSettings,
	log: Log,
): Promise<SongDictInput> {
	const client = await PlexClient.connect(grant);
	// Smart playlists are read like any other (spec #182, decision 2).
	const listed = await client.playlists("audio");
	// Titles are filtered before any items are read (#15).
	const picked =
		settings.source === "all"
			? excluding(listed, settings.exclude ?? "")
			: choosing(listed, settings.playlists, log);
	const playlists: PlaylistInput[] = [];
	for (const playlist of picked) {
		const read = await readPlaylist(client, playlist, log);
		if (read) playlists.push(read);
	}
	return { playlists };
}

function excluding(listed: PlexPlaylist[], exclude: string): PlexPlaylist[] {
	const isExcluded = nameFilter(exclude);
	return listed.filter((playlist) => !isExcluded(playlist.title));
}

/** Each pattern's matches in server order, patterns in the user's order, each playlist once. */
function choosing(listed: PlexPlaylist[], value: string, log: Log): PlexPlaylist[] {
	const picked = new Map<string, PlexPlaylist>();
	for (const pattern of entries(value)) {
		const matching = nameFilter(pattern);
		const matches = listed.filter((playlist) => matching(playlist.title));
		if (matches.length === 0) {
			log.warn(`No Plex playlist matches "${pattern}"`);
			continue;
		}
		if (matches.length > 1 && !/[*?]/.test(pattern)) {
			log.warn(`${matches.length} Plex playlists are called "${pattern}", so each is read`);
		}
		for (const playlist of matches) picked.set(playlist.ratingKey, playlist);
	}
	return [...picked.values()];
}

/** One playlist's songs, or `undefined` when it was deleted since the list, which is warned about. */
async function readPlaylist(
	client: PlexClient,
	playlist: PlexPlaylist,
	log: Log,
): Promise<PlaylistInput | undefined> {
	let items: PlexTrack[];
	try {
		items = await client.playlistItems(playlist.ratingKey);
	} catch (error) {
		if (!(error instanceof PlexError && error.status === 404)) throw error;
		log.warn(`Skipped the Plex playlist "${playlist.title}": it was deleted while being read`);
		return undefined;
	}
	const songs: SongInput[] = [];
	let notTracks = 0;
	let untitled = 0;
	for (const item of items) {
		if (item.type !== "track") {
			notTracks++;
			continue;
		}
		const song = toSong(item, client.machineIdentifier);
		if (song === undefined) untitled++;
		else songs.push(song);
	}
	const skipped = notTracks + untitled;
	if (skipped > 0) {
		const reasons = [
			notTracks && `${notTracks} not a track`,
			untitled && `${untitled} without a title`,
		].filter(Boolean);
		log.warn(
			`In "${playlist.title}", skipped ${plural(skipped, "item", "items")} (${reasons.join(", ")})`,
		);
	}
	log.info(
		`Read "${playlist.title}": ${plural(songs.length, "song", "songs")}${skipped > 0 ? `, ${skipped} skipped` : ""}`,
	);
	const description = playlist.summary?.trim();
	return {
		name: playlist.title,
		...(description ? { description } : {}),
		id: { [idSpace(client.machineIdentifier)]: playlist.ratingKey },
		songs,
	};
}
