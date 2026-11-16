// An in-process Spotify accounts service: `/authorize` and `/api/token`, enough of PKCE to check
// what the provider sends, recording every token request. Its answers follow Spotify's
// "Authorization Code with PKCE" and "Refreshing tokens" tutorials.
import { createHash } from "node:crypto";
import type { OAuthEndpoints } from "../src/auth/pkce-flow.ts";

/** How the next refresh is answered; one entry is used per refresh, then `rotate` again. */
export type RefreshAnswer = "rotate" | "keep" | "invalid_grant" | "invalid_client" | "server-error";

interface Issued {
	challenge: string;
	redirectUri: string;
	clientId: string;
	scope: string;
}

export interface FakeAccounts {
	endpoints: OAuthEndpoints;
	/** Every form posted to `/api/token`, in order. */
	tokenRequests: URLSearchParams[];
	/** Every access and refresh token issued, so a test can look for them where they mustn't be. */
	issued: string[];
	refreshAnswers: RefreshAnswer[];
	/** What the next code exchange grants; Spotify's own answer echoes the requested scope. */
	grantScope?: string;
	/** Follows a `begin` URL as the browser would after consent: the return's query. */
	consent(authoriseUrl: string, answer?: "allow" | "deny"): Promise<Record<string, string>>;
	stop(): Promise<void>;
}

const base64url = (buffer: Buffer) => buffer.toString("base64url");

export function startFakeAccounts(): FakeAccounts {
	const codes = new Map<string, Issued>();
	const refreshTokens = new Map<string, string>(); // refresh token -> client id
	let serial = 0;
	const next = (prefix: string) => `${prefix}-${++serial}-${crypto.randomUUID()}`;

	const fake: FakeAccounts = {
		endpoints: {},
		tokenRequests: [],
		issued: [],
		refreshAnswers: [],
		async consent(authoriseUrl, answer = "allow") {
			const response = await fetch(`${authoriseUrl}&fake_answer=${answer}`, { redirect: "manual" });
			const location = response.headers.get("Location");
			if (!location) throw new Error(`The fake refused to authorise: ${await response.text()}`);
			return Object.fromEntries(new URL(location).searchParams);
		},
		stop: () => server.stop(true),
	};

	const tokens = (clientId: string, scope: string, refresh: boolean) => {
		const accessToken = next("access");
		fake.issued.push(accessToken);
		const body: Record<string, unknown> = {
			access_token: accessToken,
			token_type: "Bearer",
			scope,
			expires_in: 3600,
		};
		if (refresh) {
			const refreshToken = next("refresh");
			fake.issued.push(refreshToken);
			refreshTokens.set(refreshToken, clientId);
			body.refresh_token = refreshToken;
		}
		return Response.json(body);
	};

	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const url = new URL(request.url);
			if (request.method === "GET" && url.pathname === "/authorize") {
				const q = url.searchParams;
				const redirectUri = q.get("redirect_uri") ?? "";
				const back = new URL(redirectUri);
				if (q.get("fake_answer") === "deny") {
					back.searchParams.set("error", "access_denied");
				} else {
					if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256") {
						return new Response("INVALID_REQUEST", { status: 400 });
					}
					const code = next("code");
					codes.set(code, {
						challenge: q.get("code_challenge") ?? "",
						redirectUri,
						clientId: q.get("client_id") ?? "",
						scope: q.get("scope") ?? "",
					});
					back.searchParams.set("code", code);
				}
				const state = q.get("state");
				if (state) back.searchParams.set("state", state);
				return new Response(null, { status: 302, headers: { Location: back.href } });
			}
			if (request.method === "POST" && url.pathname === "/api/token") {
				if (request.headers.get("Content-Type") !== "application/x-www-form-urlencoded") {
					return Response.json({ error: "invalid_request" }, { status: 400 });
				}
				const form = new URLSearchParams(await request.text());
				fake.tokenRequests.push(form);
				const clientId = form.get("client_id") ?? "";
				if (form.get("grant_type") === "authorization_code") {
					const issued = codes.get(form.get("code") ?? "");
					codes.delete(form.get("code") ?? "");
					const verifier = form.get("code_verifier") ?? "";
					const challenge = base64url(createHash("sha256").update(verifier).digest());
					if (
						!issued ||
						issued.clientId !== clientId ||
						issued.redirectUri !== form.get("redirect_uri") ||
						issued.challenge !== challenge
					) {
						return Response.json(
							{ error: "invalid_grant", error_description: "Invalid authorization code" },
							{ status: 400 },
						);
					}
					return tokens(clientId, fake.grantScope ?? issued.scope, true);
				}
				if (form.get("grant_type") === "refresh_token") {
					const answer = fake.refreshAnswers.shift() ?? "rotate";
					if (answer === "server-error") return new Response("upstream", { status: 503 });
					if (answer === "invalid_client") {
						return Response.json({ error: "invalid_client" }, { status: 400 });
					}
					const token = form.get("refresh_token") ?? "";
					if (answer === "invalid_grant" || refreshTokens.get(token) !== clientId) {
						return Response.json(
							{ error: "invalid_grant", error_description: "Refresh token revoked" },
							{ status: 400 },
						);
					}
					const scope = "playlist-read-private playlist-read-collaborative user-library-read";
					if (answer === "keep") return tokens(clientId, scope, false);
					refreshTokens.delete(token);
					return tokens(clientId, scope, true);
				}
				return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
			}
			return new Response("Not Found", { status: 404 });
		},
	});
	fake.endpoints = {
		spotify: {
			authoriseUrl: `${server.url.origin}/authorize`,
			tokenUrl: `${server.url.origin}/api/token`,
		},
	};
	return fake;
}
