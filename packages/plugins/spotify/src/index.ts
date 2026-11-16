import { createSpotifyPlugin } from "./spotify.ts";

export { createSpotifyPlugin, type SpotifyPluginOptions } from "./spotify.ts";

export default createSpotifyPlugin({ apiBase: "https://api.spotify.com/v1" });
