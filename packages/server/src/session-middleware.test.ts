import { describe, expect, test } from "bun:test";
import { ErrorBody, InstanceInfo, RedirectUri } from "./api.ts";
import { PROXY_REFUSAL_MESSAGE } from "./session-middleware.ts";
import { bodyOf, CLIENT_ADDRESS_HEADER, useTestApp } from "./test-support.ts";

const testApp = useTestApp();

const from = (address: string, headers: Record<string, string> = {}) => ({
	[CLIENT_ADDRESS_HEADER]: address,
	...headers,
});

const countRows = (sqlite: import("bun:sqlite").Database, table: string) =>
	(sqlite.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("bootstrapped", () => {
	test("resolves the install's account with no cookie and no sessions row", async () => {
		const { call, raw } = await testApp();
		const response = await call("POST", "/api/applets", {
			name: "mine",
			enabled: true,
			definition: {
				inputs: [{ plugin: "source", settings: { playlist: "a" } }],
				modifiers: [],
				outputs: [{ plugin: "plex", settings: {} }],
			},
		});
		expect(response.status).toBe(201);
		expect(response.headers.get("Set-Cookie")).toBeNull();
		expect(raw((sqlite) => countRows(sqlite, "sessions"))).toBe(0);
	});

	test("a public address is flagged exposed and warned about once, never blocked", async () => {
		const { call, logger } = await testApp();
		for (let i = 0; i < 2; i++) {
			const response = await call("GET", "/api/instance", undefined, from("203.0.113.9"));
			expect(await bodyOf(response, InstanceInfo)).toEqual({ exposed: true });
		}
		expect(logger.lines.filter((line) => line.includes("203.0.113.9"))).toEqual([
			expect.stringMatching(/^warn:/),
		]);
	});

	test.each([
		"127.0.0.1",
		"10.1.2.3",
		"172.20.0.5",
		"192.168.1.20",
		"169.254.10.1",
		"100.101.102.103",
		"::1",
		"fe80::1",
		"fd7a:115c:a1e0::1",
		"::ffff:192.168.1.20",
	])("%s is private and not flagged", async (address) => {
		const { call, logger } = await testApp();
		const response = await call("GET", "/api/instance", undefined, from(address));
		expect(await bodyOf(response, InstanceInfo)).toEqual({ exposed: false });
		expect(logger.lines.filter((line) => line.includes(address))).toEqual([]);
	});

	test("a public IPv6 address is flagged exposed", async () => {
		const { call } = await testApp();
		const response = await call("GET", "/api/instance", undefined, from("2001:db8::7"));
		expect(await bodyOf(response, InstanceInfo)).toEqual({ exposed: true });
	});
});

describe("proxy", () => {
	const proxied = () => testApp({ authSource: "proxy", trustedProxies: ["172.18.0.0/16"] });

	test("a trusted address with the header reaches the account; each request's user is logged, not stored", async () => {
		const { call, logger, raw } = await proxied();
		for (const user of ["cal", "cal", "sam"]) {
			const response = await call(
				"GET",
				"/api/instance",
				undefined,
				from("172.18.0.2", { "Remote-User": user }),
			);
			expect(await bodyOf(response, InstanceInfo)).toEqual({ exposed: false });
		}
		expect(logger.lines.filter((line) => /"(cal|sam)"/.test(line))).toEqual([
			expect.stringContaining('"cal"'),
			expect.stringContaining('"cal"'),
			expect.stringContaining('"sam"'),
		]);
		expect(raw((sqlite) => countRows(sqlite, "sessions"))).toBe(0);
		expect(raw((sqlite) => countRows(sqlite, "federated_identities"))).toBe(0);
	});

	test.each([
		["a trusted address without the header", "172.18.0.2", {}],
		["a trusted address with an empty header", "172.18.0.2", { "Remote-User": "  " }],
		["an untrusted address with the header", "192.168.1.20", { "Remote-User": "cal" }],
	])("%s is 401, with no fallback", async (_, address, headers) => {
		const { call } = await proxied();
		const response = await call("GET", "/api/applets", undefined, from(address, headers));
		expect(response.status).toBe(401);
		expect(await bodyOf(response, ErrorBody)).toEqual({ message: PROXY_REFUSAL_MESSAGE });
	});
});

describe("forwarded headers", () => {
	const forwarded = { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "music.example.com" };

	test("are honoured from a trusted proxy", async () => {
		const { call } = await testApp({ trustedProxies: ["172.18.0.0/16"] });
		const response = await call(
			"GET",
			"/api/services/spotify/redirect-uri",
			undefined,
			from("172.18.0.2", { Host: "ultrasonics:5000", ...forwarded }),
		);
		expect(await bodyOf(response, RedirectUri)).toEqual({
			redirectUri: "https://music.example.com/services/spotify",
		});
	});

	test("are ignored from any other address", async () => {
		const { call } = await testApp({ trustedProxies: ["172.18.0.0/16"] });
		const response = await call(
			"GET",
			"/api/services/spotify/redirect-uri",
			undefined,
			from("192.168.1.20", { Host: "192.168.1.50:5000", ...forwarded }),
		);
		expect(await bodyOf(response, RedirectUri)).toEqual({
			// The plain LAN origin, so Spotify's rule sends the return to loopback (spec #136).
			redirectUri: "http://127.0.0.1:5000/services/spotify",
		});
	});
});
