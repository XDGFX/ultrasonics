import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/500.css";
import "@fontsource/roboto-mono/700.css";
import "@fontsource/montserrat-alternates/700.css";
import "./logo-fonts.css";
import "./theme.css";
import { createApp } from "vue";
import App from "./App.vue";
import { type ApiClient, apiKey } from "./api-client.ts";
import { createHttpApi } from "./http-api.ts";
import { createAppRouter } from "./router.ts";

/**
 * The built app talks to the server. The dev server runs on the fake unless `VITE_API=http`, which
 * reaches the server through Vite's `/api` proxy. `import.meta.env.DEV` is fixed at build time, so
 * the fake and its seed stay out of the production bundle.
 */
async function chooseApi(): Promise<ApiClient> {
	if (import.meta.env.DEV && import.meta.env.VITE_API !== "http") {
		const [{ createFakeApi }, { devSeed }] = await Promise.all([
			import("./fake-api.ts"),
			import("./dev-seed.ts"),
		]);
		return createFakeApi(devSeed(new URLSearchParams(location.search).has("first-run")));
	}
	return createHttpApi({ origin: location.origin, EventSource });
}

const api = await chooseApi();
createApp(App).provide(apiKey, api).use(createAppRouter(api)).mount("#app");
