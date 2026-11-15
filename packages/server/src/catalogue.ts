import {
	type AuthSpec,
	Component,
	type JSONSchema,
	type Plugin,
	type PluginRegistry,
	type Service,
	toFormSchema,
} from "@ultrasonics/plugin-sdk";
import type { z } from "zod";
import type { PluginInfo } from "./api.ts";

/** A service as the official plugins declare it: one spec, shared by every plugin naming it. */
export interface CatalogueService {
	spec: AuthSpec;
	/** The spec's fields as form JSON Schema, converted once at boot. */
	fields: JSONSchema;
	/** Plugin names, in registry order; the first is the one whose `test()` a configure runs. */
	usedBy: string[];
}

/** Every official plugin, loaded and converted once at boot (ADR-0019 §1). */
export interface Catalogue {
	plugins: ReadonlyMap<string, Plugin>;
	info: readonly PluginInfo[];
	services: ReadonlyMap<Service, CatalogueService>;
}

export type CatalogueResult =
	| { ok: true; catalogue: Catalogue }
	| { ok: false; problems: string[] };

/** What two declarations of one service must agree on, since one grant serves both. */
const specKey = (spec: AuthSpec, fields: JSONSchema) =>
	JSON.stringify({ flow: spec.flow, scopes: "scopes" in spec ? spec.scopes : [], fields });

/**
 * Loads every registry entry and converts each settings and auth `fields` schema. A schema outside
 * the renderable subset, or two plugins declaring one service differently, is a build bug that
 * conformance should have caught, so it aborts boot with its path.
 */
export async function loadCatalogue(registry: PluginRegistry): Promise<CatalogueResult> {
	const problems: string[] = [];
	const plugins = new Map<string, Plugin>();
	const info: PluginInfo[] = [];
	const services = new Map<Service, CatalogueService>();

	const convert = (
		schema: z.ZodType,
		where: string,
		options: { auth?: boolean } = {},
	): JSONSchema | undefined => {
		const result = toFormSchema(schema, options);
		if (result.ok) return result.jsonSchema;
		for (const issue of result.issues) {
			problems.push(`${where}, at ${JSON.stringify(issue.path)}: ${issue.message}`);
		}
		return undefined;
	};

	for (const [name, entry] of Object.entries(registry)) {
		let plugin: Plugin;
		try {
			plugin = (await entry.load()).default;
		} catch (error) {
			problems.push(`Plugin "${name}" failed to load: ${String(error)}`);
			continue;
		}
		plugins.set(name, plugin);

		const instanceSettings: PluginInfo["instanceSettings"] = {};
		for (const component of Component.options) {
			const schema = plugin.instanceSettings[component];
			const converted =
				schema && convert(schema, `Plugin "${name}" ${component} instance settings`);
			if (converted) instanceSettings[component] = converted;
		}
		const persistentSettings =
			plugin.persistentSettings &&
			convert(plugin.persistentSettings, `Plugin "${name}" persistent settings`);

		if (plugin.auth) {
			const fields = convert(plugin.auth.fields, `Plugin "${name}" auth fields`, { auth: true });
			const declared = services.get(plugin.auth.service);
			if (!declared && fields) {
				services.set(plugin.auth.service, { spec: plugin.auth, fields, usedBy: [name] });
			} else if (declared && fields) {
				if (specKey(declared.spec, declared.fields) !== specKey(plugin.auth, fields)) {
					problems.push(
						`Plugin "${name}" declares the service "${plugin.auth.service}" differently from "${declared.usedBy[0]}"; one grant serves both, so their specs must match`,
					);
				}
				declared.usedBy.push(name);
			}
		}

		info.push({
			name,
			description: plugin.description,
			version: plugin.version,
			components: [...plugin.components],
			mode: [...plugin.mode],
			...(plugin.auth ? { service: plugin.auth.service } : {}),
			...(persistentSettings ? { persistentSettings } : {}),
			instanceSettings,
		});
	}

	return problems.length > 0
		? { ok: false, problems }
		: { ok: true, catalogue: { plugins, info, services } };
}
