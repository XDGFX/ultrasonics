import { afterAll } from "bun:test";
import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import { fakeApiKey, fakeUser, startFakeLastfm } from "../test/fake-lastfm.ts";
import { createLastfmPlugin } from "./index.ts";

const server = startFakeLastfm();
afterAll(() => server.stop());

runConformance(createLastfmPlugin({ apiBase: server.apiBase, sleep: async () => {} }), {
	instanceSettings: {
		inputs: {
			valid: [
				{ select: "loved", username: fakeUser, limit: 20, name: "loved" },
				{ select: "loved", username: fakeUser },
				{ select: "top", username: fakeUser, period: "3month" },
				{ select: "recent", username: fakeUser, ending: "1m", span: "7d", limit: 1_000 },
			],
			invalid: [
				{ select: "loved", username: fakeUser, limit: 0 },
				{ select: "loved", username: fakeUser, limit: 1_001 },
				{ select: "top", username: fakeUser, period: "1week" },
				{ select: "recent", username: "  " },
				{ select: "weekly", username: fakeUser },
			],
		},
	},
	credentials: { apiKey: fakeApiKey },
});
