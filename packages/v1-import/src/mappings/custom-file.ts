import type { JsonObject } from "@ultrasonics/db";
import type { Mapping } from "../mapping.ts";

/** v1's `existing_files` choices, as v2's `existing` values. */
const V1_EXISTING_FILES: Record<string, string> = { Overwrite: "overwrite", Append: "append" };

/**
 * v1's `custom file` output, at any version (spec #180, "v1 import mapping"). Values v2 refuses,
 * such as a `.db` file name, are imported as written, so the schema check reports them.
 */
export const customFile: Mapping = {
	plugin: "custom-file",
	accepts: (name) => name === "custom file",
	instance: (_, v1) => {
		const existing =
			typeof v1.existing_files === "string"
				? (V1_EXISTING_FILES[v1.existing_files] ?? v1.existing_files)
				: v1.existing_files;
		const settings = {
			dir: v1.dir,
			existing,
			fileName: v1.playlist_name,
			pattern: v1.pattern,
		};
		// A setting v1 never saved is left out, so v2's default applies.
		return {
			settings: Object.fromEntries(
				Object.entries(settings).filter(([, value]) => value !== undefined),
			) as JsonObject,
		};
	},
};
