import { JsonObject, type Schedule, type Slot } from "@ultrasonics/db";
import type { V1ImportWrite } from "@ultrasonics/db/v1-import";
import { Component, issuesOf, type Plugin } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { DROPPED_PLUGINS } from "./dropped.ts";
import type { Mapping } from "./mapping.ts";
import type { Report } from "./report.ts";
import { parseRepr, ReprError } from "./repr.ts";
import { scheduleFromTimeTrigger } from "./time-trigger.ts";
import type { V1Database, V1PluginRow } from "./v1-database.ts";

/** What the import writes, less the account and marker the caller adds. */
export type ImportPlan = Omit<V1ImportWrite, "accountId" | "marker">;

export interface PlanContext {
	mappings: readonly Mapping<string>[];
	plugins: ReadonlyMap<string, Plugin>;
	now: number;
	timeZone: string;
}

const TIME_TRIGGER = { name: "time trigger", version: "0.2" };
const WEBHOOK = "webhook";

export const FURTHER_TIME_TRIGGER_NOTE =
	"A further time trigger was dropped: a v2 applet has one schedule.";

const V1Component = z.object({
	plugin: z.string(),
	version: z.union([z.string(), z.number()]).transform(String),
	data: JsonObject.default({}),
});

/** The applet blob v1's `webapp.py` saves, as far as the importer reads it. */
const V1Applet = z.object({
	applet_name: z.string().default(""),
	inputs: z.array(V1Component).default([]),
	modifiers: z.array(V1Component).default([]),
	outputs: z.array(V1Component).default([]),
	triggers: z.array(V1Component).default([]),
});
type V1Applet = z.infer<typeof V1Applet>;

/** A skip, thrown inside one applet's planning and caught by its caller. */
class Skip extends Error {}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Compares dotted versions numerically, so `1.10` is newer than `1.9`; a part not a number is 0. */
function compareVersions(a: string, b: string): number {
	const partsOf = (version: string) => version.split(".").map((part) => Number(part) || 0);
	const left = partsOf(a);
	const right = partsOf(b);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

const key = (name: string, version: string) => `${name}\u0000${version}`;

interface PersistentRow {
	row: V1PluginRow & { plugin: string; version: string };
	settings: JsonObject;
}

/** Parses each `plugins` blob. A failure is reported by plugin and version, never by value. */
function readPersistent(v1: V1Database, report: Report): Map<string, PersistentRow> {
	const rows = new Map<string, PersistentRow>();
	for (const row of v1.plugins) {
		const { plugin, version } = row;
		if (plugin === null || version === null || row.settings === null) continue;
		const settings = (() => {
			try {
				return JsonObject.safeParse(parseRepr(row.settings)).data;
			} catch (error) {
				if (error instanceof ReprError) return undefined;
				throw error;
			}
		})();
		if (settings) rows.set(key(plugin, version), { row: { ...row, plugin, version }, settings });
		else
			report.pluginSettings.push(`The saved settings for ${plugin} ${version} could not be read.`);
	}
	return rows;
}

function checkSchema(
	schema: z.ZodType | undefined,
	value: unknown,
	where: string,
	report: Report,
): void {
	const parsed = schema?.safeParse(value);
	if (!parsed || parsed.success) return;
	for (const issue of issuesOf(parsed.error)) {
		report.schemaFailures.push({ where, path: issue.path.join("."), message: issue.message });
	}
}

/**
 * Builds the import from v1's rows (ADR-0017 §3–§6): each applet is planned on its own, so one bad
 * applet is skipped and reported while the rest import.
 */
export function planImport(v1: V1Database, context: PlanContext, report: Report): ImportPlan {
	const { mappings, plugins } = context;
	const plan: ImportPlan = { applets: [], pluginSettings: [], grants: [] };
	const persistent = readPersistent(v1, report);
	const mappingFor = (name: string, version: string) =>
		DROPPED_PLUGINS.has(name)
			? undefined
			: mappings.find((mapping) => mapping.accepts(name, version) && plugins.has(mapping.plugin));

	/** Which applets used each v1 plugin version, for the report's note on older settings. */
	const usedBy = new Map<string, string[]>();
	const setups = new Set<Mapping<string>>();

	const planApplet = (applet: V1Applet, name: string) => {
		// Before anything else, so the reason is given wherever in the applet the plugin sits.
		const dropped = new Set(
			Component.options.flatMap((component) => applet[component].map(({ plugin }) => plugin)),
		)
			.values()
			.flatMap((plugin) => {
				const reason = DROPPED_PLUGINS.get(plugin);
				return reason ? [`It uses ${plugin}, which v2 dropped. ${reason}`] : [];
			})
			.toArray();
		if (dropped.length > 0) throw new Skip(dropped.join(" "));

		const notes: string[] = [];
		const used = new Set<Mapping<string>>();
		const slots = (component: Component): Slot[] =>
			applet[component].map((v1Component, index) => {
				const mapping = mappingFor(v1Component.plugin, v1Component.version);
				if (!mapping) {
					throw new Skip(
						`It uses ${v1Component.plugin} ${v1Component.version}, which v2 can't import.`,
					);
				}
				used.add(mapping);
				let mapped: ReturnType<Mapping<string>["instance"]>;
				try {
					mapped = mapping.instance(
						component,
						v1Component.data,
						persistent.get(key(v1Component.plugin, v1Component.version))?.settings,
					);
				} catch (error) {
					throw new Skip(
						`Importing its ${v1Component.plugin} settings failed: ${errorText(error)}`,
					);
				}
				const schema = plugins.get(mapping.plugin)?.instanceSettings[component];
				if (!schema) throw new Skip(`v2's ${mapping.plugin} has no ${component} component.`);
				checkSchema(
					schema,
					mapped.settings,
					`${name}, ${component} ${index + 1} (${mapping.plugin})`,
					report,
				);
				notes.push(...(mapped.notes ?? []));
				for (const edit of mapped.manualEdits ?? [])
					report.manualEdits.push({ applet: name, ...edit });
				return { plugin: mapping.plugin, settings: mapped.settings };
			});

		let schedule: Schedule | null = null;
		const scheduleNotes: string[] = [];
		let webhook = false;
		// Triggers first, so an applet whose trigger can't import skips before any mapping runs.
		for (const trigger of applet.triggers) {
			if (trigger.plugin === WEBHOOK) {
				webhook = true;
			} else if (trigger.plugin === TIME_TRIGGER.name && trigger.version === TIME_TRIGGER.version) {
				if (schedule) {
					notes.push(FURTHER_TIME_TRIGGER_NOTE);
					continue;
				}
				let converted: ReturnType<typeof scheduleFromTimeTrigger>;
				try {
					converted = scheduleFromTimeTrigger(trigger.data, context);
				} catch (error) {
					throw new Skip(`Its time trigger could not be converted: ${errorText(error)}`);
				}
				schedule = converted.schedule;
				scheduleNotes.push(...converted.notes);
			} else {
				throw new Skip(
					`It uses the trigger ${trigger.plugin} ${trigger.version}, which v2 can't import.`,
				);
			}
		}

		const definition = {
			inputs: slots("inputs"),
			modifiers: slots("modifiers"),
			outputs: slots("outputs"),
		};
		if (definition.inputs.length === 0) throw new Skip("It has no input.");
		if (definition.outputs.length === 0) throw new Skip("It has no output.");

		plan.applets.push({ name, definition, schedule });
		report.imported.push({ name, notes });
		if (schedule) report.scheduled.push(name);
		for (const note of scheduleNotes) report.schedules.push({ applet: name, note });
		if (webhook) report.webhooks.push(name);
		for (const mapping of used) setups.add(mapping);
	};

	for (const row of v1.applets) {
		let config = row.data ?? "";
		let name = `v1 applet ${row.id}`;
		try {
			let blob: unknown;
			try {
				blob = parseRepr(row.data ?? "");
			} catch (error) {
				if (error instanceof ReprError)
					throw new Skip(`Its saved data could not be read: ${error.message}.`);
				throw error;
			}
			config = JSON.stringify(blob, null, 2);
			const parsed = V1Applet.safeParse(blob);
			if (!parsed.success) throw new Skip("Its saved data is not in v1's applet shape.");
			name = parsed.data.applet_name.trim() || name;
			for (const component of [...Component.options, "triggers"] as const) {
				for (const { plugin, version } of parsed.data[component]) {
					const users = usedBy.get(key(plugin, version)) ?? [];
					if (!users.includes(name)) users.push(name);
					usedBy.set(key(plugin, version), users);
				}
			}
			planApplet(parsed.data, name);
		} catch (error) {
			if (!(error instanceof Skip)) throw error;
			report.skipped.push({ name, reason: error.message, config });
		}
	}

	// The newest version with settings wins for each v2 plugin (#177 decision 3).
	const candidates = new Map<string, (PersistentRow & { mapping: Mapping<string> })[]>();
	for (const entry of persistent.values()) {
		const mapping = mappingFor(entry.row.plugin, entry.row.version);
		if (!mapping?.persistent) continue;
		candidates.set(mapping.plugin, [
			...(candidates.get(mapping.plugin) ?? []),
			{ ...entry, mapping },
		]);
	}
	const servicesGranted = new Set<string>();
	for (const rows of candidates.values()) {
		const [winner, ...older] = rows.toSorted(
			(a, b) => compareVersions(b.row.version, a.row.version) || b.row.id - a.row.id,
		);
		const mapping = winner?.mapping;
		if (!winner || !mapping?.persistent) continue;
		const from = `${winner.row.plugin} ${winner.row.version}`;
		let mapped: ReturnType<NonNullable<Mapping<string>["persistent"]>>;
		try {
			mapped = mapping.persistent(winner.settings);
		} catch {
			// The error is not shown: it could quote a credential from the settings it was given.
			report.pluginSettings.push(
				`Importing the settings of ${from} failed, so none were imported.`,
			);
			continue;
		}
		if (mapped.value !== undefined) {
			plan.pluginSettings.push({ plugin: mapping.plugin, value: mapped.value });
			checkSchema(
				plugins.get(mapping.plugin)?.persistentSettings,
				mapped.value,
				`${mapping.plugin} plugin settings`,
				report,
			);
		}
		if (mapped.grant && !servicesGranted.has(mapped.grant.service)) {
			servicesGranted.add(mapped.grant.service);
			plan.grants.push({ service: mapped.grant.service, document: mapped.grant.fields });
		}
		report.pluginSettings.push(...(mapped.notes ?? []));
		for (const { row, settings } of older) {
			if (Bun.deepEquals(settings, winner.settings)) continue;
			const users = usedBy.get(key(row.plugin, row.version)) ?? [];
			report.pluginSettings.push(
				`${row.plugin} ${row.version} had different settings from ${from}, whose settings were imported.${users.length > 0 ? ` Applets that used ${row.version}: ${users.join(", ")}.` : ""}`,
			);
		}
	}

	for (const mapping of setups) {
		if (!mapping.setup) continue;
		const [list, service] =
			"reconnect" in mapping.setup
				? [report.reconnect, mapping.setup.reconnect]
				: [report.apiKeys, mapping.setup.apiKey];
		if (!list.includes(service)) list.push(service);
	}
	return plan;
}
