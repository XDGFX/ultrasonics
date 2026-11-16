import { afterEach, describe, expect, test } from "bun:test";
import { mountApp, settle } from "../test/mount-app.ts";
import type { Applet, V1ImportReport } from "./api-client.ts";
import { formatWhen } from "./clock.ts";

const applet: Applet = {
	id: "a1",
	name: "weekly",
	enabled: false,
	definition: {
		inputs: [{ plugin: "spotify", settings: { source: "all" } }],
		modifiers: [],
		outputs: [{ plugin: "plex", settings: {} }],
	},
	schedule: null,
	hasWebhook: false,
};

const report: V1ImportReport = {
	importedAt: Date.UTC(2026, 10, 16, 9),
	imported: 3,
	skipped: 2,
	markdown: "# ultrasonics v1 import\n\n## Skipped\n\n- **old mix**: uses deezer",
	dismissed: false,
};

const NOTICE = '[data-notice="v1-import"]';

afterEach(() => {
	document.body.innerHTML = "";
});

describe("the v1 import notice", () => {
	test("shows the import's counts on the applet list, linking to the full report", async () => {
		const { wrapper, router } = await mountApp("/", { applets: [applet], v1Import: report });
		const notice = wrapper.get(NOTICE);
		expect(notice.get('[data-count="imported"]').text()).toBe("3");
		expect(notice.get('[data-count="skipped"]').text()).toBe("2");

		await notice.get('[data-action="open-v1-report"]').trigger("click");
		await settle();
		expect(router.currentRoute.value.name).toBe("v1-import");
		expect(wrapper.get("[data-v1-report]").text()).toBe(report.markdown);
		expect(wrapper.get("[data-v1-imported-at]").text()).toBe(formatWhen(report.importedAt));
	});

	test("once dismissed, stays gone when the list is opened again", async () => {
		const { wrapper, router } = await mountApp("/", { applets: [applet], v1Import: report });
		await wrapper.get(`${NOTICE} [data-action="dismiss-v1-import"]`).trigger("click");
		await settle();
		expect(wrapper.find(NOTICE).exists()).toBe(false);

		await router.push("/settings");
		await router.push("/");
		await settle();
		expect(wrapper.find(NOTICE).exists()).toBe(false);
	});

	test.each([
		["no import ran", undefined],
		["it was dismissed", { ...report, dismissed: true }],
	])("is absent when %s", async (_, v1Import) => {
		const { wrapper } = await mountApp("/", { applets: [applet], v1Import });
		expect(wrapper.find(NOTICE).exists()).toBe(false);
	});

	test("shows on first run, which stands in for the list when every applet was skipped", async () => {
		const { wrapper } = await mountApp("/", { v1Import: { ...report, imported: 0 } });
		expect(wrapper.get(NOTICE).get('[data-count="skipped"]').text()).toBe("2");
	});

	test("the report screen says so when no import ran", async () => {
		const { wrapper } = await mountApp("/v1-import", { applets: [applet] });
		expect(wrapper.find("[data-v1-report]").exists()).toBe(false);
		expect(wrapper.find("[data-v1-none]").exists()).toBe(true);
	});
});
