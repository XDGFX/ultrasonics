import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import playlistMerger from "./index.ts";

runConformance(playlistMerger, {
	instanceSettings: {
		modifiers: { valid: [{}], invalid: [null, "90"] },
	},
});
