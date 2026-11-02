import type { JSONSchema } from "@ultrasonics/plugin-sdk";

const secretKeys = (schema: JSONSchema | undefined): Set<string> =>
	new Set(
		[schema, ...(schema?.oneOf ?? [])].flatMap((node) =>
			typeof node === "object" && node !== null
				? Object.entries(node.properties ?? {}).flatMap(([key, property]) =>
						typeof property === "object" && property.secret === true ? [key] : [],
					)
				: [],
		),
	);

/** A builder node's one line: its settings' text and numbers, or the plugin's description without any. */
export function summarise(
	settings: unknown,
	schema: JSONSchema | undefined,
	description: string,
): string {
	if (typeof settings !== "object" || settings === null) return description;
	const secrets = secretKeys(schema);
	const shown = Object.entries(settings).flatMap(([key, value]) =>
		!secrets.has(key) && (typeof value === "number" || (typeof value === "string" && value !== ""))
			? [String(value)]
			: [],
	);
	return shown.length > 0 ? shown.join(" · ") : description;
}
