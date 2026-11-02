import type { PluginRegistry } from "@ultrasonics/plugin-sdk";

/** Every official plugin, by name (ADR-0012 §4). The Spotify and Plex specs add their entries. */
export const officialPlugins = {} as const satisfies PluginRegistry;
