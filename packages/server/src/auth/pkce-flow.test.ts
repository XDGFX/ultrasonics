import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	AuthChallenge,
	type AuthFailure,
	AuthRequirement,
	type AuthSpec,
	defineAuth,
	isAuthFailure,
} from "@ultrasonics/plugin-sdk";
import {
	type FakeAccounts,
	type RefreshAnswer,
	startFakeAccounts,
} from "../../test/fake-spotify-accounts.ts";
import { ConnectOutcome, ErrorBody, IssuesBody, RedirectUri, ServiceStatus } from "../api.ts";
import { operatorSettings } from "../operator-settings.ts";
import { bodyOf, eventually, type TestApp, useTestApp } from "../test-support.ts";
import { createLocalAuthProvider } from "./local-auth-provider.ts";
import {
	ConnectRefusedError,
	PENDING_CONNECT_MS,
	PkceFlow,
	REFRESH_MARGIN_MS,
} from "./pkce-flow.ts";

const testApp = useTestApp();
const CLIENT_ID = "0123456789abcdef0123456789abcdef";
const OTHER_CLIENT_ID = "fedcba9876543210fedcba9876543210";
/** What the fixture plugin declares, so what a full grant carries. */
const DECLARED_SCOPE = "playlist-read-private";
const spec: AuthSpec = defineAuth({
	service: "spotify",
	flow: "oauth2-pkce",
	scopes: [DECLARED_SCOPE],
});

let accounts: FakeAccounts | undefined;
afterEach(async () => {
	await accounts?.stop();
	accounts = undefined;
});

interface Harness extends TestApp {
	accounts: FakeAccounts;
	pkce: PkceFlow;
	clock: { now: number };
	/** The provider bound to an account, as a run would build it. */
	provider(accountId?: string): ReturnType<typeof createLocalAuthProvider>;
	statusOf(): Promise<ServiceStatus["status"] | undefined>;
	/** Registers the client, begins, consents and completes: a connected grant. */
	connect(): Promise<void>;
}

async function harness(): Promise<Harness> {
	accounts = startFakeAccounts();
	const fake = accounts;
	const clock = { now: Date.UTC(2026, 10, 16) };
	const pkce = new PkceFlow({ endpoints: fake.endpoints, now: () => clock.now });
	const app = await testApp({ pkce });
	const provider = (accountId = app.mine) =>
		createLocalAuthProvider({
			accountId,
			db: app.db,
			operator: operatorSettings(app.db),
			services: ["spotify"],
			pkce,
		});
	return {
		...app,
		accounts: fake,
		pkce,
		clock,
		provider,
		async statusOf() {
			const statuses = await bodyOf(await app.call("GET", "/api/services"), ServiceStatus.array());
			return statuses.find((status) => status.service === "spotify")?.status;
		},
		async connect() {
			await app.call("PUT", "/api/services/spotify/client", { clientId: CLIENT_ID });
			const { authoriseUrl } = await bodyOf(
				await app.call("POST", "/api/services/spotify/begin", {}),
				AuthChallenge,
			);
			const returned = await fake.consent(authoriseUrl);
			const outcome = await bodyOf(
				await app.call("POST", "/api/services/spotify/complete", returned),
				ConnectOutcome,
			);
			expect(outcome).toEqual({ kind: "connected" });
		},
	};
}

const begin = async (h: Harness, headers: Record<string, string> = {}) =>
	bodyOf(await h.call("POST", "/api/services/spotify/begin", {}, headers), AuthChallenge);

const complete = async (h: Harness, query: Record<string, string>) =>
	bodyOf(await h.call("POST", "/api/services/spotify/complete", query), ConnectOutcome);

/** Rejects with an `AuthFailure` of `code`, or fails the test. */
async function expectFailure(promise: Promise<unknown>, code: AuthFailure["code"]) {
	const error = await promise.then(
		() => undefined,
		(reason: unknown) => reason,
	);
	expect(isAuthFailure(error) && error.code).toBe(code);
}

describe("requirements and the client form", () => {
	test("ask for a client, then connect, until a client ID is registered", async () => {
		const h = await harness();
		const requirements = async () =>
			AuthRequirement.array().parse(
				await (await h.call("GET", "/api/services/spotify/requirements")).json(),
			);
		expect(await requirements()).toEqual([
			{ kind: "client", service: "spotify" },
			{ kind: "connect" },
		]);
		await h.call("PUT", "/api/services/spotify/client", { clientId: CLIENT_ID });
		expect(await requirements()).toEqual([{ kind: "connect" }]);
	});

	test("the client form is a 32-hex client ID with no secret", async () => {
		const h = await harness();
		const form = (await (await h.call("GET", "/api/services/spotify/client-form")).json()) as {
			properties: Record<string, { title?: string }>;
			required: string[];
		};
		expect(Object.keys(form.properties)).toEqual(["clientId"]);
		expect(form.required).toEqual(["clientId"]);
		expect(form.properties.clientId?.title).toBe("client id");
		expect(JSON.stringify(form)).not.toMatch(/secret/i);
		for (const clientId of ["abc", `${CLIENT_ID}0`, "g".repeat(32)]) {
			const refused = await h.call("PUT", "/api/services/spotify/client", { clientId });
			expect((await bodyOf(refused, IssuesBody)).issues.map((i) => i.path)).toEqual([["clientId"]]);
		}
		expect(
			(await h.call("PUT", "/api/services/spotify/client", { clientId: CLIENT_ID })).status,
		).toBe(204);
	});

	test("begin without a registered client is refused with a message", async () => {
		const h = await harness();
		const response = await h.call("POST", "/api/services/spotify/begin", {});
		expect(response.status).toBe(409);
		expect(await bodyOf(response, ErrorBody)).toEqual({ message: expect.any(String) });
	});
});

describe("the redirect URI", () => {
	// Plain HTTP origins; an HTTPS one reaches the in-process app only through a trusted proxy, below.
	const cases = [
		["127.0.0.1:5050", "http://127.0.0.1:5050/services/spotify"],
		["[::1]:5050", "http://[::1]:5050/services/spotify"],
		["192.168.1.50:5000", "http://127.0.0.1:5000/services/spotify"],
		["localhost:5000", "http://127.0.0.1:5000/services/spotify"],
		["nas.local", "http://127.0.0.1/services/spotify"],
	] as const;

	for (const [host, expected] of cases) {
		test(`is ${expected} for a wizard at http://${host}`, async () => {
			const h = await harness();
			const response = await h.call("GET", "/api/services/spotify/redirect-uri", undefined, {
				Host: host,
			});
			expect(await bodyOf(response, RedirectUri)).toEqual({ redirectUri: expected });
		});
	}

	test("is the HTTPS origin itself behind a trusted proxy, and begin uses it", async () => {
		accounts = startFakeAccounts();
		const pkce = new PkceFlow({ endpoints: accounts.endpoints });
		const app = await testApp({ pkce, trustedProxies: ["172.18.0.0/16"] });
		const headers = {
			"x-test-client-address": "172.18.0.2",
			Host: "ultrasonics:5000",
			"X-Forwarded-Proto": "https",
			"X-Forwarded-Host": "music.example.com",
		};
		const uri = await bodyOf(
			await app.call("GET", "/api/services/spotify/redirect-uri", undefined, headers),
			RedirectUri,
		);
		expect(uri.redirectUri).toBe("https://music.example.com/services/spotify");
		await app.call("PUT", "/api/services/spotify/client", { clientId: CLIENT_ID }, headers);
		const { authoriseUrl } = await bodyOf(
			await app.call("POST", "/api/services/spotify/begin", {}, headers),
			AuthChallenge,
		);
		expect(new URL(authoriseUrl).searchParams.get("redirect_uri")).toBe(uri.redirectUri);
	});
});

describe("begin", () => {
	test("builds the authorise URL with an S256 challenge, state and the declared scopes", async () => {
		const h = await harness();
		await h.call("PUT", "/api/services/spotify/client", { clientId: CLIENT_ID });
		const { authoriseUrl } = await begin(h);
		const url = new URL(authoriseUrl);
		expect(`${url.origin}${url.pathname}`).toBe(h.accounts.endpoints.spotify?.authoriseUrl ?? "");
		const q = url.searchParams;
		expect(q.get("client_id")).toBe(CLIENT_ID);
		expect(q.get("response_type")).toBe("code");
		// The in-process app is reached at `http://localhost`, which Spotify refuses, so loopback.
		expect(q.get("redirect_uri")).toBe("http://127.0.0.1/services/spotify");
		expect(q.get("code_challenge_method")).toBe("S256");
		expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(q.get("state")?.length).toBeGreaterThanOrEqual(32);
		expect(q.get("scope")).toBe(DECLARED_SCOPE);

		// The fake checks the verifier against this challenge; a 64-character verifier passes.
		const returned = await h.accounts.consent(authoriseUrl);
		expect(await complete(h, returned)).toEqual({ kind: "connected" });
		const verifier = h.accounts.tokenRequests[0]?.get("code_verifier") ?? "";
		expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
		expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
			q.get("code_challenge") ?? "",
		);
	});
});

describe("complete", () => {
	test("exchanges the code and stores the grant encrypted, expiring an hour on", async () => {
		const h = await harness();
		await h.connect();
		const [exchange] = h.accounts.tokenRequests;
		expect(exchange?.get("grant_type")).toBe("authorization_code");
		expect(exchange?.get("client_id")).toBe(CLIENT_ID);
		expect(exchange?.get("redirect_uri")).toBe("http://127.0.0.1/services/spotify");
		expect(await h.statusOf()).toEqual({ kind: "connected" });

		const row = h.raw(
			(sqlite) =>
				sqlite
					.query("SELECT secret, expires_at FROM credentials WHERE service = 'spotify'")
					.get() as {
					secret: Uint8Array;
					expires_at: number;
				},
		);
		expect(row.expires_at).toBe(h.clock.now + 3600 * 1000);
		const text = Buffer.from(row.secret).toString("latin1");
		for (const token of h.accounts.issued) expect(text).not.toContain(token);
		const stored = await h.db.storeFor(h.mine).credentials.get("spotify");
		expect(stored?.document as unknown).toEqual({
			accessToken: h.accounts.issued[0],
			refreshToken: h.accounts.issued[1],
			scope: DECLARED_SCOPE,
			clientId: CLIENT_ID,
		});
	});

	test("accepts the query parsed from a pasted address", async () => {
		const h = await harness();
		await h.call("PUT", "/api/services/spotify/client", { clientId: CLIENT_ID });
		const returned = await h.accounts.consent((await begin(h)).authoriseUrl);
		const pasted = `http://127.0.0.1/services/spotify?${new URLSearchParams(returned)}`;
		const query = Object.fromEntries(new URL(pasted).searchParams);
		expect(await complete(h, query)).toEqual({ kind: "connected" });
	});

	test("reports a cancel on the consent page", async () => {
		const h = await harness();
		await h.call("PUT", "/api/services/spotify/client", { clientId: CLIENT_ID });
		const returned = await h.accounts.consent((await begin(h)).authoriseUrl, "deny");
		expect(returned.error).toBe("access_denied");
		expect(await complete(h, returned)).toEqual({ kind: "failed", message: expect.any(String) });
		expect(h.accounts.tokenRequests).toHaveLength(0);
		expect(await h.statusOf()).toEqual({ kind: "not-connected" });
	});

	test("rejects an unknown, reused, expired or other-account state", async () => {
		const h = await harness();
		await h.call("PUT", "/api/services/spotify/client", { clientId: CLIENT_ID });
		const startAgain = expect.any(String);

		expect(await complete(h, { code: "x", state: "never-issued" })).toEqual({
			kind: "failed",
			message: startAgain,
		});

		const used = await h.accounts.consent((await begin(h)).authoriseUrl);
		expect(await complete(h, used)).toEqual({ kind: "connected" });
		expect(await complete(h, used)).toEqual({ kind: "failed", message: startAgain });

		const stale = await h.accounts.consent((await begin(h)).authoriseUrl);
		h.clock.now += PENDING_CONNECT_MS + 1;
		expect(await complete(h, stale)).toEqual({ kind: "failed", message: startAgain });

		// Begun by this account; the other account's provider can't finish it.
		const theirs = await h.accounts.consent((await begin(h)).authoriseUrl);
		const error = await (await h.provider(h.theirs)).complete(spec, theirs).then(
			() => undefined,
			(reason: unknown) => reason,
		);
		expect(error).toBeInstanceOf(ConnectRefusedError);
		expect(await h.db.storeFor(h.theirs).credentials.get("spotify")).toBeUndefined();
		// Nor was it spent: this account still can.
		expect(await complete(h, theirs)).toEqual({ kind: "connected" });
	});
});

describe("resolve", () => {
	test("returns a fresh token without a request", async () => {
		const h = await harness();
		await h.connect();
		const requests = h.accounts.tokenRequests.length;
		const credentials = await (await h.provider()).resolve(spec);
		expect(credentials).toEqual({ accessToken: h.accounts.issued[0] });
		expect(h.accounts.tokenRequests).toHaveLength(requests);
	});

	test("refreshes within 60 seconds of expiry, storing a rotated refresh token", async () => {
		const h = await harness();
		await h.connect();
		h.clock.now += 3600 * 1000 - REFRESH_MARGIN_MS + 1;
		const credentials = await (await h.provider()).resolve(spec);
		const refresh = h.accounts.tokenRequests.at(-1);
		expect(refresh?.get("grant_type")).toBe("refresh_token");
		expect(refresh?.get("refresh_token")).toBe(h.accounts.issued[1]);
		expect(refresh?.get("client_id")).toBe(CLIENT_ID);
		expect(credentials).toEqual({ accessToken: h.accounts.issued[2] });
		const stored = await h.db.storeFor(h.mine).credentials.get("spotify");
		expect(stored?.document).toMatchObject({ refreshToken: h.accounts.issued[3] });
		expect(stored?.expiresAt).toBe(h.clock.now + 3600 * 1000);
	});

	test("keeps the old refresh token when none comes back", async () => {
		const h = await harness();
		await h.connect();
		h.accounts.refreshAnswers.push("keep");
		h.clock.now += 3600 * 1000;
		await (await h.provider()).resolve(spec);
		const stored = await h.db.storeFor(h.mine).credentials.get("spotify");
		expect(stored?.document).toMatchObject({
			accessToken: h.accounts.issued[2],
			refreshToken: h.accounts.issued[1],
		});
		// And the kept one still works next time.
		h.clock.now += 3600 * 1000;
		expect(await (await h.provider()).resolve(spec)).toEqual({
			accessToken: h.accounts.issued[3],
		});
	});

	test("two concurrent resolves share one refresh", async () => {
		const h = await harness();
		await h.connect();
		h.clock.now += 3600 * 1000;
		const before = h.accounts.tokenRequests.length;
		const [a, b] = await Promise.all([
			(await h.provider()).resolve(spec),
			(await h.provider()).resolve(spec),
		]);
		expect(a).toEqual(b);
		expect(h.accounts.tokenRequests.length - before).toBe(1);
	});

	test("invalid_grant marks the grant failed, and the services list shows reconnect", async () => {
		const h = await harness();
		await h.connect();
		h.accounts.refreshAnswers.push("invalid_grant");
		h.clock.now += 3600 * 1000;
		await expectFailure((await h.provider()).resolve(spec), "reconnect");
		const stored = await h.db.storeFor(h.mine).credentials.get("spotify");
		expect(stored?.document).toMatchObject({ failed: { at: h.clock.now } });

		const requests = h.accounts.tokenRequests.length;
		expect(await h.statusOf()).toEqual({
			kind: "failed",
			failure: { service: "spotify", code: "reconnect", message: expect.any(String) },
		});
		await expectFailure((await h.provider()).resolve(spec), "reconnect");
		expect(h.accounts.tokenRequests).toHaveLength(requests);

		// A later successful connect clears it.
		const returned = await h.accounts.consent((await begin(h)).authoriseUrl);
		expect(await complete(h, returned)).toEqual({ kind: "connected" });
		expect(await h.statusOf()).toEqual({ kind: "connected" });
		expect((await h.db.storeFor(h.mine).credentials.get("spotify"))?.document).not.toHaveProperty(
			"failed",
		);
	});

	describe("a reconnect while a refresh is in flight", () => {
		/** Holds a refresh open across a reconnect, then lets it finish with `answer`. */
		async function reconnectDuringRefresh(answer: RefreshAnswer) {
			const h = await harness();
			await h.connect();
			h.accounts.refreshAnswers.push(answer);
			h.clock.now += 3600 * 1000;
			const release = h.accounts.holdNextRefresh();
			const requests = h.accounts.tokenRequests.length;
			const resolving = (await h.provider()).resolve(spec);
			await eventually(() => expect(h.accounts.tokenRequests).toHaveLength(requests + 1));

			const returned = await h.accounts.consent((await begin(h)).authoriseUrl);
			expect(await complete(h, returned)).toEqual({ kind: "connected" });
			const reconnect = await h.db.storeFor(h.mine).credentials.get("spotify");
			release();
			return { h, resolved: await resolving, reconnect };
		}

		for (const answer of ["rotate", "invalid_grant"] as const) {
			test(`a refresh answered ${answer} leaves the reconnect's grant`, async () => {
				const { h, resolved, reconnect } = await reconnectDuringRefresh(answer);

				expect(await h.db.storeFor(h.mine).credentials.get("spotify")).toEqual(reconnect);
				expect(resolved).toEqual({ accessToken: reconnect?.document.accessToken });
				expect(await h.statusOf()).toEqual({ kind: "connected" });
			});
		}
	});

	test("a 5xx on refresh fails without marking the grant", async () => {
		const h = await harness();
		await h.connect();
		h.accounts.refreshAnswers.push("server-error");
		h.clock.now += 3600 * 1000;
		const error = await (await h.provider()).resolve(spec).catch((reason) => reason);
		expect(error).toBeInstanceOf(Error);
		expect(isAuthFailure(error)).toBe(false);
		expect(await h.statusOf()).toEqual({ kind: "connected" });
		expect((await h.db.storeFor(h.mine).credentials.get("spotify"))?.document).not.toHaveProperty(
			"failed",
		);
		// And the next try refreshes normally.
		expect(await (await h.provider()).resolve(spec)).toEqual({
			accessToken: h.accounts.issued.at(-2),
		});
	});

	test("a network error on refresh fails without marking the grant", async () => {
		const h = await harness();
		await h.connect();
		await h.accounts.stop();
		h.clock.now += 3600 * 1000;
		const error = await (await h.provider()).resolve(spec).catch((reason) => reason);
		expect(error).toBeInstanceOf(Error);
		expect(await h.statusOf()).toEqual({ kind: "connected" });
	});

	test("a changed client ID resolves to reconnect, without a request", async () => {
		const h = await harness();
		await h.connect();
		await h.call("PUT", "/api/services/spotify/client", { clientId: OTHER_CLIENT_ID });
		const requests = h.accounts.tokenRequests.length;
		await expectFailure((await h.provider()).resolve(spec), "reconnect");
		expect(await h.statusOf()).toMatchObject({ kind: "failed", failure: { code: "reconnect" } });
		expect(h.accounts.tokenRequests).toHaveLength(requests);
	});

	test("a stored scope narrower than the declared scopes resolves to reconnect", async () => {
		const h = await harness();
		h.accounts.grantScope = "";
		await h.connect();
		await expectFailure((await h.provider()).resolve(spec), "reconnect");
		expect(await h.statusOf()).toMatchObject({ kind: "failed", failure: { code: "reconnect" } });
	});

	test("no grant is not-connected; a grant with no client is misconfigured", async () => {
		const h = await harness();
		await expectFailure((await h.provider()).resolve(spec), "not-connected");
		await h.connect();
		h.raw((sqlite) => sqlite.query("DELETE FROM instance_settings").run());
		await expectFailure((await h.provider()).resolve(spec), "misconfigured");
	});
});

test("no token, code or verifier reaches a log line, error or failure", async () => {
	const h = await harness();
	await h.connect();
	h.accounts.refreshAnswers.push("server-error", "invalid_grant");
	h.clock.now += 3600 * 1000;
	const errors: unknown[] = [];
	for (let i = 0; i < 2; i += 1) {
		errors.push(await (await h.provider()).resolve(spec).catch((reason) => reason));
	}
	const secrets = [
		...h.accounts.issued,
		...h.accounts.tokenRequests.flatMap((form) =>
			[form.get("code"), form.get("code_verifier")].filter((value) => value !== null),
		),
	];
	const seen = [
		...h.logger.lines,
		...errors.map((error) => (error instanceof Error ? error.message : JSON.stringify(error))),
		JSON.stringify(await h.statusOf()),
	].join("\n");
	expect(secrets.length).toBeGreaterThan(3);
	for (const secret of secrets) expect(seen).not.toContain(secret);
});
