import { afterEach, describe, expect, test } from "bun:test";
import { defineAuth } from "@ultrasonics/plugin-sdk";
import { mountApp, settle } from "../test/mount-app.ts";
import type { FakePlugin } from "./fake-api.ts";
import { plex, spotify } from "./fake-catalogue.ts";

afterEach(() => {
	document.body.innerHTML = "";
});

type Wrapper = Awaited<ReturnType<typeof mountApp>>["wrapper"];

async function type(wrapper: Wrapper, name: string, value: string) {
	await wrapper.get(`input[name="${name}"]`).setValue(value);
}

async function click(wrapper: Wrapper, label: string) {
	const button = wrapper.findAll("button").find((candidate) => candidate.text() === label);
	if (!button) throw new Error(`no button "${label}"`);
	await button.trigger("click");
	await settle();
}

const statusOf = async (api: Awaited<ReturnType<typeof mountApp>>["api"], service: string) =>
	(await api.services.list()).find((entry) => entry.service === service)?.status.kind;

describe("the service-auth wizard", () => {
	describe("a token flow", () => {
		test("draws the declared fields and offers test and save", async () => {
			const { wrapper } = await mountApp("/services/plex");
			expect(wrapper.find('input[name="address"]').exists()).toBe(true);
			expect(wrapper.get('input[name="token"]').attributes("type")).toBe("password");
			expect(wrapper.get('form button[type="submit"]').text()).toBe("test and save");
			expect(wrapper.find("[data-connect]").exists()).toBe(false);
		});

		test("shows a field issue under its field and stores nothing", async () => {
			const { wrapper, api } = await mountApp("/services/plex");
			await type(wrapper, "address", "http://plex:32400");
			await wrapper.get("form").trigger("submit");
			await settle();
			const token = wrapper.get('input[name="token"]').element.closest(".field");
			expect(token?.querySelector(".issue")?.textContent).toBeTruthy();
			expect(await statusOf(api, "plex")).toBe("not-connected");
		});

		test("shows a failed test above the form", async () => {
			const { wrapper, api } = await mountApp("/services/plex", {
				testFailures: { plex: "connection refused" },
			});
			await type(wrapper, "address", "http://plex:32400");
			await type(wrapper, "token", "secret");
			await wrapper.get("form").trigger("submit");
			await settle();
			expect(wrapper.get(".form-issues").text()).toBe("connection refused");
			expect(await statusOf(api, "plex")).toBe("not-connected");
		});

		test("connects when the fields validate and the test passes", async () => {
			const { wrapper, api } = await mountApp("/services/plex");
			await type(wrapper, "address", "http://plex:32400");
			await type(wrapper, "token", "secret");
			await wrapper.get("form").trigger("submit");
			await settle();
			expect(wrapper.get("[data-outcome]").text()).toContain("connected");
			expect(await statusOf(api, "plex")).toBe("connected");
		});
	});

	describe("an oauth2 flow", () => {
		test("asks an unregistered operator for a client, showing the redirect URI to copy", async () => {
			const { wrapper, api } = await mountApp("/services/spotify", {
				unregisteredClients: ["spotify"],
			});
			const step = wrapper.get('[data-requirement="client"]');
			const uri = await api.services.redirectUri("spotify");
			expect(step.get("[data-copy] code").text()).toBe(uri);
			await step.get("[data-copy] button").trigger("click");
			await settle();
			expect(await navigator.clipboard.readText()).toBe(uri);
			expect(step.find('input[name="clientId"]').exists()).toBe(true);
		});

		test("moves on to connect once the client is saved", async () => {
			const { wrapper, api } = await mountApp("/services/spotify", {
				unregisteredClients: ["spotify"],
			});
			await wrapper.get('[data-requirement="client"] form').trigger("submit");
			await settle();
			expect(wrapper.get('[data-requirement="client"] .issue').text()).toBeTruthy();

			await type(wrapper, "clientId", "0123abcd");
			await wrapper.get('[data-requirement="client"] form').trigger("submit");
			await settle();
			expect(wrapper.find('[data-requirement="client"]').exists()).toBe(false);
			expect(wrapper.find("[data-connect]").exists()).toBe(true);
			expect(await api.services.requirements("spotify")).toEqual([{ kind: "connect" }]);
		});

		test("connects through begin and shows the outcome on the return", async () => {
			const { wrapper, api, router } = await mountApp("/services/spotify");
			await wrapper.get("[data-connect]").trigger("click");
			await settle();
			expect(router.currentRoute.value.path).toBe("/services/spotify");
			expect(wrapper.get("[data-outcome]").text()).toContain("connected");
			expect(await statusOf(api, "spotify")).toBe("connected");
		});

		test("shows the service's error when the return carries one", async () => {
			const { wrapper, api } = await mountApp("/services/spotify?error=access_denied");
			expect(wrapper.get("[data-outcome]").text()).toContain("access_denied");
			expect(await statusOf(api, "spotify")).toBe("not-connected");
		});
	});

	test("shows connect alone when the service asks for nothing", async () => {
		const asksNothing: FakePlugin = {
			...plex,
			auth: defineAuth({ service: "plex", flow: "none" }),
		};
		const { wrapper } = await mountApp("/services/plex", { plugins: [spotify, asksNothing] });
		expect(wrapper.find("form").exists()).toBe(false);
		expect(wrapper.findAll("[data-requirement]")).toHaveLength(0);
		await click(wrapper, "connect");
		expect(wrapper.get("[data-outcome]").text()).toContain("connected");
	});
});
