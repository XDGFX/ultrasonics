import { createDeezerPlugin } from "./deezer.ts";

export { createDeezerPlugin, type DeezerPluginOptions } from "./deezer.ts";

export default createDeezerPlugin({ apiBase: "https://api.deezer.com" });
