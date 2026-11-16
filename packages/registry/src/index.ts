import type { PluginRegistry } from "@ultrasonics/plugin-sdk";

// Each `path` is resolved here, where the package is a dependency: under isolated installs the bare
// specifier resolves from nowhere else (docs/research/worker-executor-preflight.md §8).
/** Every official plugin, by name (ADR-0012 §4). */
export const officialPlugins = {
	"custom-file": {
		path: import.meta.resolve("@ultrasonics/plugin-custom-file"),
		load: () => import("@ultrasonics/plugin-custom-file"),
	},
	deezer: {
		path: import.meta.resolve("@ultrasonics/plugin-deezer"),
		load: () => import("@ultrasonics/plugin-deezer"),
	},
	lastfm: {
		path: import.meta.resolve("@ultrasonics/plugin-lastfm"),
		load: () => import("@ultrasonics/plugin-lastfm"),
	},
	"local-playlists": {
		path: import.meta.resolve("@ultrasonics/plugin-local-playlists"),
		load: () => import("@ultrasonics/plugin-local-playlists"),
	},
	"log-tracks": {
		path: import.meta.resolve("@ultrasonics/plugin-log-tracks"),
		load: () => import("@ultrasonics/plugin-log-tracks"),
	},
	plex: {
		path: import.meta.resolve("@ultrasonics/plugin-plex"),
		load: () => import("@ultrasonics/plugin-plex"),
	},
	spotify: {
		path: import.meta.resolve("@ultrasonics/plugin-spotify"),
		load: () => import("@ultrasonics/plugin-spotify"),
	},
} as const satisfies PluginRegistry;
