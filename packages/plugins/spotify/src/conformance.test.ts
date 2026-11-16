import { afterAll } from "bun:test";
import { runConformance } from "@ultrasonics/plugin-sdk/conformance";
import { fakeToken, playlistIds, startFakeSpotify } from "../test/fake-spotify.ts";
import { createSpotifyPlugin } from "./index.ts";

const server = startFakeSpotify();
afterAll(() => server.stop());

runConformance(createSpotifyPlugin({ apiBase: server.apiBase }), {
	instanceSettings: {
		inputs: {
			valid: [
				{ source: "chosen", playlists: `https://open.spotify.com/playlist/${playlistIds.focus}` },
				{
					source: "chosen",
					playlists: `spotify:playlist:${playlistIds.focus}, ${playlistIds.roadTrip}`,
				},
				{ source: "all" },
				{ source: "all", exclude: "gym" },
				{ source: "liked" },
				{ source: "liked", name: "loved" },
			],
			invalid: [
				{ source: "chosen", playlists: "https://open.spotify.com/album/1AbCdEfGhIjKlMnOpQrStU" },
				{ source: "chosen", playlists: "discover weekly" },
				{ source: "chosen", playlists: "  " },
				{ source: "chosen", playlists: " , ," },
				{ source: "followed" },
				{ source: "liked", name: "" },
			],
		},
	},
	credentials: { accessToken: fakeToken },
});
