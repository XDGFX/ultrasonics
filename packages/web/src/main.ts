import "@fontsource/roboto-mono/400.css";
import "@fontsource/roboto-mono/500.css";
import "@fontsource/montserrat-alternates/700.css";
import "./theme.css";
import { createApp } from "vue";
import App from "./App.vue";
import { apiKey } from "./api-client.ts";
import { devSeed } from "./dev-seed.ts";
import { createFakeApi } from "./fake-api.ts";
import { createAppRouter } from "./router.ts";

// The fake stands in until the HTTP client exists.
const api = createFakeApi(devSeed(new URLSearchParams(location.search).has("first-run")));

createApp(App).provide(apiKey, api).use(createAppRouter(api)).mount("#app");
