const SAMPLE = "It was a v1 sample, not a feature.";

/**
 * v1 plugins v2 doesn't port, by their v1 name, with the reason the report gives (#177, "Plugins
 * v2 dropped"). No mapping is consulted for them, for their applets or their saved settings.
 */
export const DROPPED_PLUGINS: ReadonlyMap<string, string> = new Map([
	[
		"spotify mixer",
		"Spotify closed its recommendations endpoint to apps created after 27 November 2024, so v2 can't build it.",
	],
	[
		"deezer",
		"Deezer has closed app registration, and v1's Deezer used a token issued to the dead proxy's app. v2 reads public Deezer playlists by link: rebuild the applet with v2's Deezer input if that fits.",
	],
	[
		"system command",
		"Arbitrary shell commands have no place in a product many accounts share. Use v2's webhook trigger or the CLI runner instead.",
	],
	["rickroll", SAMPLE],
	["skeleton", SAMPLE],
]);
