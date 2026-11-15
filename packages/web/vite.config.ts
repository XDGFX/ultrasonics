import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [vue()],
	// The server's default port; `bun run start` in packages/server serves the API there.
	server: { proxy: { "/api": "http://localhost:5000" } },
	resolve: {
		alias: { "node:url": fileURLToPath(new URL("./src/node-url-stub.ts", import.meta.url)) },
	},
});
