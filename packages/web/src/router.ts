import { createRouter, createWebHistory, type RouterHistory } from "vue-router";

declare module "vue-router" {
	interface RouteMeta {
		/** The rail entry the route belongs under. */
		section?: "applets" | "settings";
	}
}

import AppletBuilder from "./AppletBuilder.vue";
import AppletList from "./AppletList.vue";
import type { ApiClient } from "./api-client.ts";
import FirstRun from "./FirstRun.vue";
import RunView from "./RunView.vue";
import ServiceWizard from "./ServiceWizard.vue";
import SettingsScreen from "./SettingsScreen.vue";

const applets = { section: "applets" } as const;
const settings = { section: "settings" } as const;

/** One route per Phase 1 screen; first run stands in for the list while there are no applets. */
export function createAppRouter(api: ApiClient, history: RouterHistory = createWebHistory()) {
	const hasApplets = async () => (await api.applets.list()).length > 0;
	return createRouter({
		history,
		routes: [
			{
				path: "/",
				name: "applets",
				meta: applets,
				component: AppletList,
				beforeEnter: async () => ((await hasApplets()) ? true : { name: "first-run" }),
			},
			{
				path: "/welcome",
				name: "first-run",
				meta: applets,
				component: FirstRun,
				beforeEnter: async () => ((await hasApplets()) ? { name: "applets" } : true),
			},
			{ path: "/applets/new", name: "new-applet", component: AppletBuilder, meta: applets },
			{
				path: "/applets/:id",
				name: "builder",
				component: AppletBuilder,
				props: true,
				meta: applets,
			},
			{ path: "/runs/:id", name: "run", component: RunView, props: true, meta: applets },
			{ path: "/settings", name: "settings", component: SettingsScreen, meta: settings },
			// The OAuth return lands here too, with the outcome in the query.
			{
				path: "/services/:service",
				name: "wizard",
				component: ServiceWizard,
				props: true,
				meta: settings,
			},
			{ path: "/:unknown(.*)*", redirect: { name: "applets" } },
		],
	});
}
