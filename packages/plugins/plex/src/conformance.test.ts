import { afterAll } from "bun:test";
import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import { fakeToken, startFakePlex } from "../test/fake-plex.ts";
import plex from "./index.ts";

const server = startFakePlex();
afterAll(() => server.stop());

runConformance(plex, {
	instanceSettings: {
		outputs: {
			valid: [{}, { library: "Music" }, { library: "1" }, { existing: "update" }],
			invalid: [{ existing: "replace" }],
		},
	},
	credentials: { serverUrl: server.url, token: fakeToken },
});
