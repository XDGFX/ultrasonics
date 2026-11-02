import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import App from "../src/App.vue";
import { apiKey } from "../src/api-client.ts";
import { createFakeApi, type FakeSeed } from "../src/fake-api.ts";
import { catalogue } from "../src/fake-catalogue.ts";
import { createAppRouter } from "../src/router.ts";

/** Mounts the whole app at `path` against a fake seeded with `seed`, as the dev server runs it. */
export async function mountApp(path: string, seed: Partial<FakeSeed> = {}) {
	const api = createFakeApi({ plugins: catalogue, ...seed });
	const router = createAppRouter(api, createMemoryHistory());
	await router.push(path);
	const wrapper = mount(App, {
		attachTo: document.body,
		global: { plugins: [router], provide: { [apiKey]: api } },
	});
	await settle();
	return { wrapper, router, api };
}

/** Lets pending API calls and the navigations they trigger finish. */
export async function settle() {
	await flushPromises();
	await flushPromises();
}
