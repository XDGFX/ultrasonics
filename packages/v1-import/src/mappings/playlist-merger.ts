import type { Mapping } from "../mapping.ts";

/** Said once per import, whichever applets used the merger (spec #186, "v1 import mapping"). */
export const THRESHOLDS_NOTE =
	"The playlist merger's fuzzy ratio was dropped: v2 has no match thresholds, and decides duplicates with a new matcher.";

/**
 * v1's `playlist merger` at any version. Both its ratios, per applet and global, are dropped; the
 * note rides on the global settings because v1 can't build a merger applet before they are saved.
 */
export const playlistMergerMapping: Mapping = {
	plugin: "playlist-merger",
	accepts: (name) => name === "playlist merger",
	persistent: () => ({ notes: [THRESHOLDS_NOTE] }),
	instance: () => ({ settings: {} }),
};
