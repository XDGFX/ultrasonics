import type { JsonObject } from "@ultrasonics/db";
import type { Mapping } from "../mapping.ts";

/** v1's legacy Plex plugin, which wrote m3u files and asked for both sides' music paths. */
const LEGACY = new Set(["plex", "plex legacy"]);

const isLegacy = (name: string, version: string) => LEGACY.has(name) && version === "0.1";

export const LEGACY_PATHS_NOTE =
	"The legacy Plex plugin's music directory settings were dropped: v2 adds tracks through Plex itself, without reaching your files.";

const EXISTING: Record<string, "append" | "update"> = { Append: "append", Update: "update" };

/** v1 stored the library as Plex listed it, `Title [id]`; v2 takes the id, or a title. */
function libraryOf(sectionId: string): string {
	return /\[(\d+)\]$/.exec(sectionId)?.[1] ?? sectionId;
}

/** A setting's text, or a throw naming the setting and never its value. */
function textOf(settings: JsonObject, name: string): string {
	const value = settings[name];
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is not set`);
	return value.trim();
}

/** `plex` 1.0 and `plex beta` 1.0, and the legacy `plex` / `plex legacy` 0.1 (ADR-0017 §4). */
export const plexMapping: Mapping = {
	plugin: "plex",
	accepts: (name, version) =>
		isLegacy(name, version) || (["plex", "plex beta"].includes(name) && version === "1.0"),
	persistent: (v1) => {
		const legacyPaths = ["plex_prepend", "ultrasonics_prepend"].some(
			(name) => typeof v1[name] === "string" && v1[name] !== "",
		);
		return {
			grant: {
				service: "plex",
				fields: {
					serverUrl: textOf(v1, "server_url"),
					token: textOf(v1, "plex_token"),
					verifyTls: v1.check_ssl === undefined ? true : v1.check_ssl === "Yes",
				},
			},
			notes: legacyPaths ? [LEGACY_PATHS_NOTE] : [],
		};
	},
	instance: (component, v1) => {
		if (component !== "outputs") throw new Error("v2 can't import a Plex input yet.");
		const settings: JsonObject = {};
		if (typeof v1.section_id === "string" && v1.section_id !== "")
			settings.library = libraryOf(v1.section_id);
		const existing = v1.existing_playlists;
		// Only the legacy output lacks the setting, and it always replaced a playlist's tracks.
		settings.existing =
			existing === undefined
				? "update"
				: typeof existing === "string"
					? (EXISTING[existing] ?? existing)
					: existing;
		return { settings };
	},
};
