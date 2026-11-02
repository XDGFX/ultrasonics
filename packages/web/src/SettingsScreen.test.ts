import { afterEach, describe, expect, test } from "bun:test";
import { mountApp, settle } from "../test/mount-app.ts";

afterEach(() => {
	document.body.innerHTML = "";
});

type Wrapper = Awaited<ReturnType<typeof mountApp>>["wrapper"];

const serviceRow = (wrapper: Wrapper, service: string) =>
	wrapper.get(`[data-service="${service}"]`);

describe("settings", () => {
	test("lists each service with its status, the plugins using it, and a way into its wizard", async () => {
		const { wrapper } = await mountApp("/settings", {
			grants: {
				plex: { kind: "connected" },
				spotify: {
					kind: "failed",
					failure: { service: "spotify", code: "reconnect", message: "the grant was revoked" },
				},
			},
		});
		const plex = serviceRow(wrapper, "plex");
		expect(plex.get(".st").text()).toBe("✓");
		expect(plex.text()).toContain("used by plex");
		expect(plex.get(".tag").attributes("data-needs-action")).toBe("false");
		expect(plex.get(".acts a").text()).toBe("✎");
		expect(plex.get(".acts a").attributes("href")).toBe("/services/plex");

		const spotify = serviceRow(wrapper, "spotify");
		expect(spotify.get(".st").text()).toBe("✗");
		expect(spotify.text()).toContain("the grant was revoked");
		expect(spotify.get(".tag").attributes("data-needs-action")).toBe("true");
		expect(spotify.get(".acts a").text()).toBe("reconnect");
		expect(spotify.get(".acts a").attributes("href")).toBe("/services/spotify");
	});

	test("lists only the plugins that have persistent settings", async () => {
		const { wrapper } = await mountApp("/settings");
		expect(wrapper.findAll("[data-plugin]").map((row) => row.attributes("data-plugin"))).toEqual([
			"plex",
		]);
	});

	test("opens a plugin's stored settings in the side panel and saves them through the API", async () => {
		const { wrapper, api } = await mountApp("/settings", {
			settings: { plex: { library: "music" } },
		});
		await wrapper.get('[data-plugin="plex"] button').trigger("click");
		await settle();
		const input = wrapper.get('.panel input[name="library"]');
		expect((input.element as HTMLInputElement).value).toBe("music");

		await input.setValue("audiobooks");
		await wrapper.get(".panel form").trigger("submit");
		await settle();
		expect(wrapper.find(".panel [data-saved]").exists()).toBe(true);
		expect((await api.settings.get("plex")).value).toEqual({ library: "audiobooks" });
	});

	test("shows the issues of a stored value that no longer parses", async () => {
		const { wrapper } = await mountApp("/settings", { settings: { plex: { library: 7 } } });
		await wrapper.get('[data-plugin="plex"] button').trigger("click");
		await settle();
		const field = wrapper.get('.panel input[name="library"]').element.closest(".field");
		expect(field?.querySelector(".issue")?.textContent).toBeTruthy();
		expect(wrapper.get('.panel button[type="submit"]').attributes("disabled")).toBeDefined();
	});
});
