import { afterAll } from "bun:test";
import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import { playlistIds, startFakeDeezer } from "../test/fake-deezer.ts";
import { createDeezerPlugin } from "./index.ts";

const server = startFakeDeezer();
afterAll(() => server.stop());

runConformance(createDeezerPlugin({ apiBase: server.apiBase }), {
	instanceSettings: {
		inputs: {
			valid: [
				{ playlists: `https://www.deezer.com/en/playlist/${playlistIds.eighties}` },
				{
					playlists: `https://www.deezer.com/playlist/${playlistIds.eighties}?utm_source=deezer, ${playlistIds.rock}`,
				},
				{ playlists: playlistIds.eighties },
			],
			invalid: [
				{ playlists: "  " },
				{ playlists: "https://link.deezer.com/s/31ZQ0xYzAbC" },
				{ playlists: "https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ" },
			],
		},
	},
});
