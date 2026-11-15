import type { PluginRegistry } from "@ultrasonics/plugin-sdk";

/** Every official plugin, by name (ADR-0012 §4). */
export const officialPlugins = {
	plex: { path: "@ultrasonics/plugin-plex", load: () => import("@ultrasonics/plugin-plex") },
} as const satisfies PluginRegistry;
