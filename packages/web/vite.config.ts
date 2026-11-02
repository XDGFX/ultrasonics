import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: { "node:url": fileURLToPath(new URL("./src/node-url-stub.ts", import.meta.url)) },
	},
});
