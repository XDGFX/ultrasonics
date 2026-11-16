import type { JsonObject } from "@ultrasonics/db";
import type { InstanceMapping, Mapping } from "../mapping.ts";
import { convertV1Filter } from "../v1-filter.ts";

export const LOCAL_ROOT_NOTE =
	"local playlists: the music folder for ultrasonics is the path inside v1's container. Mount your music at the same place in v2's container, or change it in the plugin's settings.";

export const ONE_ROOT_NOTE =
	"local playlists: v1 had only one of its two prepends filled in, so neither was imported. Set both music folders in the plugin's settings if your playlists need them.";

export const RECURSIVE_OUTPUT_NOTE =
	"Its local playlists output searched subfolders for existing playlists. v2 writes only to the top level of the folder.";

export const UNKNOWN_RETENTION_NOTE =
	"Its local playlists output had a backup retention v2 doesn't recognise, so it keeps the newest 3 backups.";

/** v1's `retention` options, as v2's `backups`. */
const BACKUPS: Record<string, string> = {
	"No Backups": "0",
	"3 Backups": "3",
	"5 Backups": "5",
	"10 Backups": "10",
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A v1 input's filter, which v1 applied with an anchored `re.match` (`name_filter.filter_path`). */
function v1InputSettings(v1: JsonObject): InstanceMapping {
	const settings = { dir: text(v1.dir), recursive: v1.recursive === "Yes" };
	const pattern = typeof v1.filter === "string" ? v1.filter : "";
	if (pattern.trim() === "") return { settings };
	const converted = convertV1Filter(pattern, "match");
	return converted.ok
		? { settings: { ...settings, filter: converted.filter }, notes: converted.notes }
		: {
				settings: { ...settings, filter: pattern },
				manualEdits: [{ pattern, reason: converted.reason }],
			};
}

function v1OutputSettings(v1: JsonObject): InstanceMapping {
	const retention = text(v1.retention);
	const backups = BACKUPS[retention];
	const notes = v1.recursive === "Yes" ? [RECURSIVE_OUTPUT_NOTE] : [];
	if (retention && !backups) notes.push(UNKNOWN_RETENTION_NOTE);
	return { settings: { dir: text(v1.dir), ...(backups ? { backups } : {}) }, notes };
}

/** v1's `local playlists`, which shipped as 0.3 (spec #178, "v1 import mapping"). */
export const localPlaylists: Mapping = {
	plugin: "local-playlists",
	accepts: (name) => name === "local playlists",
	persistent(v1) {
		const playlistRoot = text(v1.local_prepend);
		const localRoot = text(v1.ultrasonics_prepend);
		if (!playlistRoot && !localRoot) return {};
		if (!playlistRoot || !localRoot) return { notes: [ONE_ROOT_NOTE] };
		return { value: { playlistRoot, localRoot }, notes: [LOCAL_ROOT_NOTE] };
	},
	instance: (component, v1) =>
		component === "inputs" ? v1InputSettings(v1) : v1OutputSettings(v1),
};
