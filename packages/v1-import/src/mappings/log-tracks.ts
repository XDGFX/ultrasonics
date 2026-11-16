import type { Mapping } from "../mapping.ts";

/** v1's `log tracks` (spec #181): it had no settings of either kind, and shipped only 0.1. */
export const logTracks: Mapping = {
	plugin: "log-tracks",
	accepts: (name) => name === "log tracks",
	instance: () => ({ settings: {} }),
};
