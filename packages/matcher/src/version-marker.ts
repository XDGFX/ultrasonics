import { parseTitle } from "./normalise.ts";

/** Words in a title's decorations that name a different recording, read after normalisation. */
const versionMarkers = {
	live: /\b(?:live|unplugged|in concert)\b/,
	remix: /\b(?:remix|remixed|rework|dub|bootleg)\b|(?<!\boriginal )\bmix\b/,
	edit: /\b(?:edit|radio version|short version|extended)\b/,
	acoustic: /\bacoustic\b/,
	instrumental: /\b(?:instrumental|karaoke)\b/,
	cover: /\b(?:cover|in the style of|tribute)\b/,
	"re-recorded": /\b(?:re ?record(?:ed|ing)?|taylors version)\b/,
	demo: /\bdemo\b/,
} as const;
export type VersionMarker = keyof typeof versionMarkers;

/** A remaster is the same recording (#104 §2), so this marks a preference, never a veto. */
export const remasterMarker = /\bremaster/;

/** The version markers in a title's decorations; a marker word in the song's own name doesn't count. */
export function versionMarkersIn(title: string): Set<VersionMarker> {
	const { decorations } = parseTitle(title);
	return new Set(
		(Object.keys(versionMarkers) as VersionMarker[]).filter((marker) =>
			decorations.some((text) => versionMarkers[marker].test(text)),
		),
	);
}

export function isRemastered(title: string): boolean {
	return parseTitle(title).decorations.some((text) => remasterMarker.test(text));
}
