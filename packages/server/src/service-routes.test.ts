import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AuthRequirement, defineAuth, definePlugin } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import {
	GOOD_TOKEN,
	plex,
	registryOf,
	source,
	spotify,
	THROWING_TOKEN,
} from "../test/fixture-plugins.ts";
import { ConfigureResult, ErrorBody, IssuesBody, ServiceStatus } from "./api.ts";
import { bodyOf, useTestApp } from "./test-support.ts";

const testApp = useTestApp();
const plexFields = { url: "http://plex.lan:32400", token: GOOD_TOKEN };

const statusOf = async (call: Awaited<ReturnType<typeof testApp>>["call"], service: string) => {
	const statuses = await bodyOf(await call("GET", "/api/services"), ServiceStatus.array());
	return statuses.find((status) => status.service === service)?.status;
};

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("status", () => {
	test("lists each service once, with the plugins that use it", async () => {
		const { call } = await testApp();
		expect(await bodyOf(await call("GET", "/api/services"), ServiceStatus.array())).toEqual([
			{
				service: "plex",
				flow: "token",
				status: { kind: "not-connected" },
				usedBy: ["plex", "plex-mixer"],
			},
			{
				service: "spotify",
				flow: "oauth2-pkce",
				status: { kind: "not-connected" },
				usedBy: ["spotify"],
			},
		]);
	});

	test("comes from stored state alone, with no network call", async () => {
		const { call, db, mine } = await testApp();
		const store = db.storeFor(mine);
		await store.credentials.put("plex", plexFields, null);
		await store.credentials.put("spotify", { accessToken: "a" }, null);
		const outbound: string[] = [];
		globalThis.fetch = Object.assign(
			async (input: string | URL | Request) => {
				outbound.push(String(input));
				return new Response();
			},
			{ preconnect: realFetch.preconnect },
		);

		expect(await statusOf(call, "plex")).toEqual({ kind: "connected" });
		expect(await statusOf(call, "spotify")).toEqual({
			kind: "failed",
			failure: { service: "spotify", code: "misconfigured", message: expect.any(String) },
		});
		expect((await call("PUT", "/api/services/spotify/client", { clientId: "abc" })).status).toBe(
			204,
		);
		expect(await statusOf(call, "spotify")).toEqual({ kind: "connected" });
		expect(outbound).toEqual([]);
	});
});

describe("requirements", () => {
	test("a token service asks for its declared fields, as a form", async () => {
		const { call } = await testApp();
		const requirements = AuthRequirement.array().parse(
			await (await call("GET", "/api/services/plex/requirements")).json(),
		);
		expect(requirements).toEqual([
			{
				kind: "fields",
				schema: expect.objectContaining({ required: ["url", "token"] }),
			},
		]);
	});

	test("a none service asks for nothing", async () => {
		const open = definePlugin({
			...{ description: "A test fixture", version: "1.0.0", mode: ["playlists"] as const },
			name: "open",
			auth: defineAuth({ service: "spotify", flow: "none" }),
			instanceSettings: { inputs: z.object({}) },
			run: { inputs: async () => ({ playlists: [] }) },
		});
		const { call } = await testApp({ registry: registryOf(source, open) });
		expect(await (await call("GET", "/api/services/spotify/requirements")).json()).toEqual([]);
		expect(await statusOf(call, "spotify")).toEqual({ kind: "connected" });
	});

	test("a service no plugin uses is a 404", async () => {
		const { call } = await testApp({ registry: registryOf(source, plex) });
		expect((await call("GET", "/api/services/spotify/requirements")).status).toBe(404);
		expect((await call("GET", "/api/services/tidal/requirements")).status).toBe(404);
	});
});

describe("configure: test, then save", () => {
	test("fields that don't parse are invalid, with issues", async () => {
		const { call } = await testApp();
		const response = await call("POST", "/api/services/plex/configure", { url: "" });
		expect(response.status).toBe(422);
		const result = await bodyOf(response, ConfigureResult);
		expect(result.kind === "invalid" && result.issues.map((i) => i.path)).toEqual([
			["url"],
			["token"],
		]);
	});

	test("a failed test stores nothing", async () => {
		const { call } = await testApp();
		await call("PUT", "/api/settings/plex", { library: "Music" });
		const response = await call("POST", "/api/services/plex/configure", {
			...plexFields,
			token: "wrong",
		});
		expect(await bodyOf(response, ConfigureResult)).toEqual({
			kind: "test-failed",
			message: "Plex refused the token wrong",
		});
		expect(await statusOf(call, "plex")).toEqual({ kind: "not-connected" });
	});

	test("a passed test saves the grant, encrypted at rest", async () => {
		const { call, raw, dataDir, mine } = await testApp();
		await call("PUT", "/api/settings/plex", { library: "Music" });
		const response = await call("POST", "/api/services/plex/configure", plexFields);
		expect(await bodyOf(response, ConfigureResult)).toEqual({ kind: "saved" });
		expect(await statusOf(call, "plex")).toEqual({ kind: "connected" });

		const secret = raw(
			(sqlite) =>
				sqlite.query("SELECT secret FROM credentials WHERE service = 'plex'").get() as {
					secret: Uint8Array;
				},
		).secret;
		expect(Buffer.from(secret).toString("latin1")).not.toContain(GOOD_TOKEN);
		expect(existsSync(join(dataDir, "accounts", mine, "plugins", "plex"))).toBe(true);
	});

	test("a test() that throws is a 500 naming the plugin, and stores nothing", async () => {
		const { call, logger } = await testApp();
		await call("PUT", "/api/settings/plex", { library: "Music" });
		const response = await call("POST", "/api/services/plex/configure", {
			...plexFields,
			token: THROWING_TOKEN,
		});
		expect(response.status).toBe(500);
		expect((await bodyOf(response, ErrorBody)).message).toContain("plex");
		expect(logger.lines.some((line) => line.startsWith("error:"))).toBe(true);
		expect(await statusOf(call, "plex")).toEqual({ kind: "not-connected" });
	});

	test("the tester's persistent settings must parse before it runs", async () => {
		const { call } = await testApp();
		const response = await call("POST", "/api/services/plex/configure", plexFields);
		const result = await bodyOf(response, ConfigureResult);
		expect(result.kind).toBe("test-failed");
		expect(await statusOf(call, "plex")).toEqual({ kind: "not-connected" });
	});

	test("a service without a test() saves once its fields parse", async () => {
		const untested = definePlugin({ ...plex, name: "untested", test: undefined });
		const { call } = await testApp({ registry: registryOf(untested) });
		const response = await call("POST", "/api/services/plex/configure", plexFields);
		expect(await bodyOf(response, ConfigureResult)).toEqual({ kind: "saved" });
	});

	test("an OAuth service takes no pasted credentials", async () => {
		const { call } = await testApp();
		const response = await call("POST", "/api/services/spotify/configure", {});
		expect(response.status).toBe(400);
	});
});

describe("the operator's client and OAuth", () => {
	test("the client form is the provider's, and a registration is validated", async () => {
		const { call } = await testApp();
		const form = (await (await call("GET", "/api/services/spotify/client-form")).json()) as {
			required?: string[];
		};
		expect(form.required).toEqual(["clientId"]);
		const refused = await call("PUT", "/api/services/spotify/client", { clientId: " " });
		expect((await bodyOf(refused, IssuesBody)).issues.map((i) => i.path)).toEqual([["clientId"]]);
	});

	test("a token service has no client, redirect or OAuth step", async () => {
		const { call } = await testApp();
		for (const [method, path] of [
			["GET", "client-form"],
			["GET", "redirect-uri"],
			["PUT", "client"],
			["POST", "begin"],
			["POST", "complete"],
		] as const) {
			const response = await call(
				method,
				`/api/services/plex/${path}`,
				method === "GET" ? undefined : {},
			);
			expect({ path, status: response.status }).toEqual({ path, status: 400 });
		}
	});

	test("begin and complete wait for the Spotify spec", async () => {
		const { call } = await testApp({ registry: registryOf(spotify) });
		expect((await call("POST", "/api/services/spotify/begin", {})).status).toBe(501);
		expect((await call("POST", "/api/services/spotify/complete", { code: "x" })).status).toBe(501);
	});
});
