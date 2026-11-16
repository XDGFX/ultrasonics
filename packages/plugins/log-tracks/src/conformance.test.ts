import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import logTracks from "./index.ts";

runConformance(logTracks, {
	instanceSettings: { outputs: { valid: [{}], invalid: [null, "log"] } },
});
