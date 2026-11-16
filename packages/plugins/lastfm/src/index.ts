import { createLastfmPlugin } from "./lastfm.ts";

export { createLastfmPlugin, type LastfmPluginOptions } from "./lastfm.ts";

export default createLastfmPlugin({ apiBase: "https://ws.audioscrobbler.com/2.0/" });
