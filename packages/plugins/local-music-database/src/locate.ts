import { bestMatch } from "@ultrasonics/matcher";
import type { Log, Playlist, Song, SongDictInput } from "@ultrasonics/plugin-sdk";
import type { LibraryIndex } from "./library-index.ts";

/**
 * Gives each song without a `location` the location of the file the matcher picks from the
 * index's candidates (spec #179, "Matching"). Nothing but `location` changes, a song that has one
 * keeps it, and `playlists` is left as it was.
 */
export function locateSongs(
	playlists: readonly Playlist[],
	index: LibraryIndex,
	log: Log,
): SongDictInput {
	return {
		version: 1,
		playlists: playlists.map((playlist) => {
			const unlocated: Song[] = [];
			let tried = 0;
			const songs = playlist.songs.map((song) => {
				if (song.location !== undefined) return song;
				tried += 1;
				const location = bestMatch(song, index.candidates(song))?.candidate.location;
				if (location !== undefined) return { ...song, location };
				unlocated.push(song);
				return song;
			});
			log.info(`"${playlist.name}": located ${tried - unlocated.length} of ${tried}`);
			if (unlocated.length > 0) {
				const names = unlocated.map((song) => `${song.artists.join(", ")} - ${song.title}`);
				log.debug(`"${playlist.name}": no file found for ${names.join("; ")}`);
			}
			return { ...playlist, songs };
		}),
	};
}
