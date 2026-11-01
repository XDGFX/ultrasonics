import { describe, expect, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import {
	type AuthChallenge,
	type AuthFailure,
	type AuthProvider,
	type AuthRequirement,
	type AuthSpec,
	type Credentials,
	defineAuth,
	Flow,
	isAuthFailure,
	type JSONSchema,
	type Service,
	services,
} from "./index.ts";

const plexAuth = defineAuth({
	service: "plex",
	flow: "token",
	fields: z.object({
		serverUrl: z.string().url(),
		token: z.string().min(1),
		verifyTls: z.boolean().default(true),
	}),
});

const spotifyAuth = defineAuth({
	service: "spotify",
	flow: "oauth2-pkce",
	scopes: ["playlist-read-private"],
});

describe("services", () => {
	test("lists the Phase 1 services", () => {
		expect(services).toEqual(["spotify", "plex"]);
		expectTypeOf<Service>().toEqualTypeOf<"spotify" | "plex">();
	});
});

describe("Flow", () => {
	test("is how a secret is obtained (ADR-0013 §1)", () => {
		expect(Flow.options).toEqual(["oauth2-pkce", "oauth2", "token", "none"]);
	});
});

describe("defineAuth", () => {
	test("a token flow keeps its declared fields", () => {
		expect(plexAuth.fields.parse({ serverUrl: "http://plex.local", token: "t" })).toEqual({
			serverUrl: "http://plex.local",
			token: "t",
			verifyTls: true,
		});
		expectTypeOf<Credentials<typeof plexAuth>>().toEqualTypeOf<{
			serverUrl: string;
			token: string;
			verifyTls: boolean;
		}>();
	});

	test("an oauth2 flow is given an access token as its fields", () => {
		expect(spotifyAuth).toMatchObject({ service: "spotify", scopes: ["playlist-read-private"] });
		expect(spotifyAuth.fields.parse({ accessToken: "a" })).toEqual({ accessToken: "a" });
		expectTypeOf<Credentials<typeof spotifyAuth>>().toEqualTypeOf<{ accessToken: string }>();
	});

	test("a none flow has no fields", () => {
		const none = defineAuth({ service: "plex", flow: "none" });
		expect(none.fields.parse({})).toEqual({});
	});

	test("rejects at compile time what the flows do not take", () => {
		// @ts-expect-error -- an unknown service would open a second, empty grant (ADR-0013 §2)
		defineAuth({ service: "spotfy", flow: "oauth2", scopes: [] });
		// @ts-expect-error -- a token flow must declare what it collects
		defineAuth({ service: "plex", flow: "token" });
		// @ts-expect-error -- an oauth2 flow's fields are the SDK's, not the plugin's
		defineAuth({ service: "spotify", flow: "oauth2", scopes: [], fields: z.object({}) });
	});
});

describe("isAuthFailure", () => {
	const failure: AuthFailure = {
		service: "spotify",
		code: "reconnect",
		message: "The refresh token was revoked",
	};

	test("recognises a plain-data failure, even after a structured clone", () => {
		expect(isAuthFailure(failure)).toBe(true);
		expect(isAuthFailure(structuredClone(failure))).toBe(true);
	});

	test.each([
		["an Error", new Error("reconnect")],
		["an unknown code", { ...failure, code: "expired" }],
		["an unknown service", { ...failure, service: "deezer" }],
		["no message", { service: "plex", code: "not-connected" }],
		["undefined", undefined],
	])("rejects %s", (_, value) => {
		expect(isAuthFailure(value)).toBe(false);
	});
});

describe("the AuthProvider surface (ADR-0013 §4)", () => {
	test("has the agreed plain-data shapes", () => {
		expectTypeOf<AuthRequirement>().toEqualTypeOf<
			| { kind: "fields"; schema: JSONSchema }
			| { kind: "client"; service: Service }
			| { kind: "connect" }
		>();
		expectTypeOf<AuthChallenge>().toEqualTypeOf<{ authoriseUrl: string }>();
		expectTypeOf<AuthFailure>().toEqualTypeOf<{
			service: Service;
			code: "not-connected" | "reconnect" | "misconfigured";
			message: string;
		}>();
	});

	test("takes only the spec, with no account id anywhere", async () => {
		const provider: AuthProvider = {
			requirements: () => [],
			resolve: async (spec) => spec.fields.parse({ accessToken: "a" }),
			configure: async () => {},
			begin: async () => ({ authoriseUrl: "https://accounts.spotify.com/authorize" }),
			complete: async () => {},
		};
		expectTypeOf<Parameters<AuthProvider["resolve"]>>().toEqualTypeOf<[AuthSpec]>();
		expectTypeOf<Parameters<AuthProvider["configure"]>>().toEqualTypeOf<[AuthSpec, unknown]>();
		expectTypeOf<Parameters<AuthProvider["complete"]>>().toEqualTypeOf<[AuthSpec, unknown]>();
		expect(await provider.resolve(spotifyAuth)).toEqual({ accessToken: "a" });
	});
});
