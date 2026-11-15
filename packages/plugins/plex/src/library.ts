import { type Library, PlexError } from "./plex-client.ts";

/** Plex calls a music library's type after its top-level item, the artist. */
const musicType = "artist";

/**
 * The one music library `setting` names (ticket #77): blank means the only one, else a title
 * matched without regard to case, else an all-digit section id. Anything else throws
 * `misconfigured`, listing the music libraries, and never widens to every library.
 */
export function resolveLibrary(libraries: Library[], setting: string | undefined): Library {
	const music = libraries.filter((library) => library.type === musicType);
	const wanted = setting?.trim() ?? "";
	const found =
		wanted === ""
			? music
			: music.filter((library) => library.title.toLowerCase() === wanted.toLowerCase());
	const byId =
		found.length === 0 && /^\d+$/.test(wanted)
			? music.filter((library) => library.key === wanted)
			: [];
	const [library, ...others] = found.length > 0 ? found : byId;
	if (library !== undefined && others.length === 0) return library;

	const titles = music.map((library) => `"${library.title}"`).join(", ") || "none";
	const problem =
		wanted === ""
			? music.length === 0
				? "This Plex server has no music library."
				: "This Plex server has several music libraries, so the library setting must name one."
			: library === undefined
				? `No music library on this Plex server is called "${wanted}".`
				: `Several music libraries on this Plex server are called "${wanted}".`;
	throw new PlexError("misconfigured", `${problem} Its music libraries: ${titles}.`);
}
