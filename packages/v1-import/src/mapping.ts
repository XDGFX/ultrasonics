import type { JsonObject, JsonValue } from "@ultrasonics/db";
import type { Component } from "@ultrasonics/plugin-sdk";
import type { officialPlugins } from "@ultrasonics/registry";
import { lastfmMapping } from "./mappings/lastfm.ts";
import { logTracks } from "./mappings/log-tracks.ts";
import { plexMapping } from "./mappings/plex.ts";

/** A v1 setting the importer could not convert, shown in the report beside why. */
export interface ManualEdit {
	pattern: string;
	reason: string;
}

/** What a mapping makes of the newest v1 persistent settings for its plugin. */
export interface PersistentMapping {
	/** The v2 `plugin_settings` value; none is written when absent. */
	value?: JsonValue;
	/** A credential to encrypt and store as the account's grant for `service`. */
	grant?: { service: string; fields: JsonObject };
	notes?: string[];
}

/** What a mapping makes of one v1 component's per-instance data. */
export interface InstanceMapping {
	settings: JsonValue;
	notes?: string[];
	manualEdits?: ManualEdit[];
}

/**
 * How one v1 plugin becomes a v2 plugin (ADR-0017 §5). Internal to the importer, never an SDK
 * type: each Phase 2 plugin ticket adds its module to {@link MAPPINGS}.
 */
export interface Mapping<Plugin extends string = keyof typeof officialPlugins> {
	/** The v2 plugin it produces. */
	plugin: Plugin;
	/** Whether it maps this v1 plugin name at this version, as v1 wrote them. */
	accepts(name: string, version: string): boolean;
	/** What the user must do in v2 for an applet using it to run, listed in the report. */
	setup?: { reconnect: string } | { apiKey: string };
	/** A throw imports no settings for the plugin; the report says so without the error's text. */
	persistent?(v1Settings: JsonObject): PersistentMapping;
	/** A throw skips the applet and reports the error, so its message must not hold a setting. */
	instance(
		component: Component,
		v1Data: JsonObject,
		v1Persistent: JsonObject | undefined,
	): InstanceMapping;
}

/** Every v1 plugin the importer maps. Until a plugin's ticket lands, its applets skip as unknown. */
export const MAPPINGS: readonly Mapping[] = [lastfmMapping, logTracks, plexMapping];
