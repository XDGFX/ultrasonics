import type { Mapping } from "../mapping.ts";

/** The report's reminder that the imported folder is where v1's container saw the music. */
export const musicDirNote = (musicDir: string) =>
	`The local music database's music folder is ${musicDir}, the path inside v1's container. If v2's container mounts your music somewhere else, change it in that plugin's settings.`;

/**
 * v1's `local music database`, at any version (spec #179). `fuzzy_ratio` is dropped without
 * comment, since v2 has no threshold. v1's instance form was empty, so its data maps to `{}`.
 */
export const localMusicDatabase: Mapping = {
	plugin: "local-music-database",
	accepts: (name) => name === "local music database",
	persistent: (v1) =>
		typeof v1.music_dir === "string"
			? { value: { musicDir: v1.music_dir }, notes: [musicDirNote(v1.music_dir)] }
			: {},
	instance: () => ({ settings: {} }),
};
