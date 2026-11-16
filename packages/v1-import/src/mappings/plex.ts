import type { JsonObject } from "@ultrasonics/db";
import type { InstanceMapping, Mapping } from "../mapping.ts";
import { convertV1Filter } from "../v1-filter.ts";

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

/**
 * A Plex input reads every playlist when its filter is blank, else the playlists its converted
 * filter chooses. A filter that won't convert is kept as written, so the applet survives and the
 * report asks for an edit (spec #182, decision 1). v1's input never read `section_id`.
 */
function inputOf(v1: JsonObject): InstanceMapping {
	const pattern = typeof v1.filter === "string" ? v1.filter : "";
	if (pattern.trim() === "") return { settings: { source: "all" } };
	// v1's Plex input ran `re.search`, so a match anywhere in the title was enough.
	const converted = convertV1Filter(pattern, "search");
	return converted.ok
		? { settings: { source: "chosen", playlists: converted.filter }, notes: converted.notes }
		: {
				settings: { source: "chosen", playlists: pattern },
				manualEdits: [{ pattern, reason: converted.reason }],
			};
}

/** `plex` 1.0 and `plex beta` 1.0, and the legacy `plex` / `plex legacy` 0.1 (ADR-0017 §4). */
export const plexMapping: Mapping = {
	plugin: "plex",
	accepts: (name, version) =>
		isLegacy(name, version) || (["plex", "plex beta"].includes(name) && version === "1.0"),
	persistent: (v1) => ({
		grant: {
			service: "plex",
			fields: {
				serverUrl: textOf(v1, "server_url"),
				token: textOf(v1, "plex_token"),
				verifyTls: v1.check_ssl === undefined ? true : v1.check_ssl === "Yes",
			},
		},
	}),
	instance: (component, v1, v1Persistent) => {
		if (component === "inputs") return inputOf(v1);
		const settings: JsonObject = {};
		if (typeof v1.section_id === "string" && v1.section_id !== "")
			settings.library = libraryOf(v1.section_id);
		// Only the legacy output lacks the setting, and it always replaced a playlist's tracks.
		const existing = v1.existing_playlists ?? "Update";
		settings.existing = typeof existing === "string" ? (EXISTING[existing] ?? existing) : existing;
		const legacyPaths = ["plex_prepend", "ultrasonics_prepend"].some(
			(name) => typeof v1Persistent?.[name] === "string" && v1Persistent[name] !== "",
		);
		return { settings, notes: legacyPaths ? [LEGACY_PATHS_NOTE] : [] };
	},
};
