import type { AccountStore } from "@ultrasonics/db";
import type { AuthChallenge, AuthFailure, AuthSpec, Service } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** Where a service authorises and issues tokens: server-side data, never a plugin's (spec #136). */
export interface OAuthEndpoint {
	authoriseUrl: string;
	tokenUrl: string;
}
export type OAuthEndpoints = Partial<Record<Service, OAuthEndpoint>>;

export const serviceEndpoints: OAuthEndpoints = {
	spotify: {
		authoriseUrl: "https://accounts.spotify.com/authorize",
		tokenUrl: "https://accounts.spotify.com/api/token",
	},
};

/** How long a started connect may wait for its return. */
export const PENDING_CONNECT_MS = 10 * 60_000;
/** A token this close to expiry is refreshed before it is handed out. */
export const REFRESH_MARGIN_MS = 60_000;
const timeoutMs = 30_000;

/**
 * The `oauth2-pkce` grant document, encrypted in `credentials.secret` (spec #136, decision 6).
 * `clientId` binds it to the app that issued it; `failed` is set only by `invalid_grant`.
 */
export const PkceGrant = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
	scope: z.string(),
	clientId: z.string(),
	failed: z.object({ at: z.number(), message: z.string() }).optional(),
});
export type PkceGrant = z.infer<typeof PkceGrant>;

/** A connect that could not finish, with a message the wizard shows. */
export class ConnectRefusedError extends Error {
	override readonly name = "ConnectRefusedError";
}

interface PendingConnect {
	service: Service;
	verifier: string;
	redirectUri: string;
	clientId: string;
	startedAt: number;
}

const TokenResponse = z.object({
	access_token: z.string().min(1),
	expires_in: z.number().positive(),
	refresh_token: z.string().min(1).optional(),
	scope: z.string().optional(),
});
const TokenError = z.object({ error: z.string() });

type TokenAnswer =
	| { ok: true; tokens: z.output<typeof TokenResponse> }
	| { ok: false; status: number; error: string | undefined };

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const randomToken = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

const isLoopback = (hostname: string) => hostname === "127.0.0.1" || hostname === "[::1]";

/**
 * The redirect URI for a wizard at `origin` (spec #136, decision 1): the origin itself when the
 * service will accept it, otherwise the loopback address on the same port, finished by pasting.
 */
export function redirectUriFor(service: Service, origin: string): string {
	const url = new URL(origin);
	if (url.protocol === "https:" || isLoopback(url.hostname)) {
		return `${url.origin}/services/${service}`;
	}
	const port = url.port ? `:${url.port}` : "";
	return `http://127.0.0.1${port}/services/${service}`;
}

export const authFailure = (
	service: Service,
	code: AuthFailure["code"],
	message: string,
): AuthFailure => ({ service, code, message });

/** Every `oauth2*` service needs the operator's own app first (ADR-0013 §7). */
export const noClientFailure = (service: Service) =>
	authFailure(service, "misconfigured", `Register your own ${service} app before connecting`);

/**
 * A stored grant document, checked from stored state alone: the grant, or why it needs a
 * reconnect. Shared by `resolve()` and the services list, so both say the same.
 */
export function checkGrant(
	spec: AuthSpec,
	document: unknown,
	clientId: string,
): { ok: true; grant: PkceGrant } | { ok: false; reason: string } {
	const parsed = PkceGrant.safeParse(document);
	if (!parsed.success) {
		return { ok: false, reason: `The stored ${spec.service} grant is unreadable; connect again` };
	}
	const reason = reconnectReason(spec, parsed.data, clientId);
	return reason === undefined ? { ok: true, grant: parsed.data } : { ok: false, reason };
}

function reconnectReason(spec: AuthSpec, grant: PkceGrant, clientId: string): string | undefined {
	if (grant.failed) return grant.failed.message;
	if (grant.clientId !== clientId) {
		return `Your ${spec.service} app changed since you connected; connect again`;
	}
	const granted = new Set(grant.scope.split(" "));
	const scopes = "scopes" in spec ? spec.scopes : [];
	if (scopes.some((scope) => !granted.has(scope))) {
		return `ultrasonics now needs more access to ${spec.service} than you granted; connect again`;
	}
	return undefined;
}

export interface PkceFlowOptions {
	/** The token and authorise URLs per service; tests point them at a fake. */
	endpoints?: OAuthEndpoints;
	now?: () => number;
}

/**
 * The `oauth2-pkce` flow, one per server, since a provider is built per request but a connect
 * spans two requests and a refresh must be shared by every run. Nothing here logs, and no error it
 * throws carries a token, code or verifier.
 */
export class PkceFlow {
	readonly #endpoints: OAuthEndpoints;
	readonly #now: () => number;
	/** Started connects, keyed by account and `state`, so one account can't finish another's. */
	readonly #pending = new Map<string, PendingConnect>();
	/** Refreshes in flight, keyed by account and service. */
	readonly #refreshing = new Map<string, Promise<string>>();

	constructor(options: PkceFlowOptions = {}) {
		this.#endpoints = options.endpoints ?? serviceEndpoints;
		this.#now = options.now ?? Date.now;
	}

	/** Whether the server knows where `service` authorises; without it, nothing can connect. */
	supports(service: Service): boolean {
		return this.#endpoints[service] !== undefined;
	}

	async begin(
		accountId: string,
		spec: AuthSpec,
		clientId: string,
		redirectUri: string,
	): Promise<AuthChallenge> {
		const endpoint = this.#endpoint(spec.service);
		this.#forgetExpired();
		const verifier = randomToken(48);
		const state = randomToken(32);
		this.#pending.set(accountKey(accountId, state), {
			service: spec.service,
			verifier,
			redirectUri,
			clientId,
			startedAt: this.#now(),
		});
		const challenge = base64url(
			new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
		);
		const url = new URL(endpoint.authoriseUrl);
		url.search = new URLSearchParams({
			client_id: clientId,
			response_type: "code",
			redirect_uri: redirectUri,
			code_challenge_method: "S256",
			code_challenge: challenge,
			state,
			scope: ("scopes" in spec ? spec.scopes : []).join(" "),
		}).toString();
		return { authoriseUrl: url.href };
	}

	/** Exchanges the code a return carried, replacing any earlier grant and its `failed` mark. */
	async complete(
		accountId: string,
		spec: AuthSpec,
		store: AccountStore,
		callback: unknown,
	): Promise<void> {
		const query = z.record(z.string(), z.string()).safeParse(callback);
		const params = query.success ? query.data : {};
		const state = params.state;
		const pending = state === undefined ? undefined : this.#take(accountId, state);
		const error = params.error;
		if (error !== undefined) {
			throw new ConnectRefusedError(
				error === "access_denied"
					? `You cancelled on ${spec.service}'s consent page, so ${spec.service} is not connected`
					: `${spec.service} refused to connect (${safeCode(error)})`,
			);
		}
		if (!pending || pending.service !== spec.service) {
			throw new ConnectRefusedError(
				`That connect was not started here, was already used, or is more than ${PENDING_CONNECT_MS / 60_000} minutes old; start again`,
			);
		}
		const code = params.code;
		if (!code) {
			throw new ConnectRefusedError(`${spec.service} sent no code back; start again`);
		}
		const answer = await this.#token(spec.service, {
			grant_type: "authorization_code",
			code,
			redirect_uri: pending.redirectUri,
			client_id: pending.clientId,
			code_verifier: pending.verifier,
		}).catch(() => {
			throw new ConnectRefusedError(
				`Could not reach ${spec.service} to finish connecting; start again`,
			);
		});
		if (!answer.ok || !answer.tokens.refresh_token) {
			throw new ConnectRefusedError(
				answer.ok
					? `${spec.service} issued no refresh token; start again`
					: `${spec.service} refused the connection (${refusalOf(answer)}); start again`,
			);
		}
		const { tokens } = answer;
		const grant: PkceGrant = {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token ?? "",
			scope: tokens.scope ?? ("scopes" in spec ? spec.scopes.join(" ") : ""),
			clientId: pending.clientId,
		};
		await store.credentials.put(spec.service, grant, this.#now() + tokens.expires_in * 1000);
	}

	/** The access token, refreshed lazily and single-flight; rejects with an `AuthFailure`. */
	async resolve(
		accountId: string,
		spec: AuthSpec,
		store: AccountStore,
		clientId: string | undefined,
	): Promise<{ accessToken: string }> {
		const usable = await this.#usableGrant(spec, store, clientId);
		if (this.#fresh(usable.expiresAt)) return { accessToken: usable.grant.accessToken };
		const key = accountKey(accountId, spec.service);
		let flight = this.#refreshing.get(key);
		if (!flight) {
			flight = this.#refresh(spec, store, clientId).finally(() => this.#refreshing.delete(key));
			this.#refreshing.set(key, flight);
		}
		return { accessToken: await flight };
	}

	async #usableGrant(spec: AuthSpec, store: AccountStore, clientId: string | undefined) {
		const stored = await store.credentials.get(spec.service);
		if (!stored) {
			throw authFailure(spec.service, "not-connected", `${spec.service} is not connected`);
		}
		if (clientId === undefined) throw noClientFailure(spec.service);
		const checked = checkGrant(spec, stored.document, clientId);
		if (!checked.ok) throw authFailure(spec.service, "reconnect", checked.reason);
		return { grant: checked.grant, expiresAt: stored.expiresAt };
	}

	#fresh(expiresAt: number | null): boolean {
		return expiresAt !== null && expiresAt - this.#now() > REFRESH_MARGIN_MS;
	}

	async #refresh(
		spec: AuthSpec,
		store: AccountStore,
		clientId: string | undefined,
	): Promise<string> {
		// Read again inside the flight: a flight that just finished may have refreshed it already.
		const { grant, expiresAt } = await this.#usableGrant(spec, store, clientId);
		if (this.#fresh(expiresAt)) return grant.accessToken;
		let answer: TokenAnswer;
		try {
			answer = await this.#token(spec.service, {
				grant_type: "refresh_token",
				refresh_token: grant.refreshToken,
				client_id: grant.clientId,
			});
		} catch {
			throw new Error(`Could not reach ${spec.service} to refresh its access token`);
		}
		if (answer.ok) {
			const { tokens } = answer;
			const refreshed: PkceGrant = {
				accessToken: tokens.access_token,
				// Spotify's refresh "might not include a new refresh token"; the old one then still works.
				refreshToken: tokens.refresh_token ?? grant.refreshToken,
				scope: tokens.scope ?? grant.scope,
				clientId: grant.clientId,
			};
			await store.credentials.put(spec.service, refreshed, this.#now() + tokens.expires_in * 1000);
			return refreshed.accessToken;
		}
		if (answer.error === "invalid_grant") {
			const message = `${spec.service} no longer accepts this connection; connect again`;
			await store.credentials.put(
				spec.service,
				{ ...grant, failed: { at: this.#now(), message } },
				expiresAt,
			);
			throw authFailure(spec.service, "reconnect", message);
		}
		if (answer.error === "invalid_client") {
			throw authFailure(
				spec.service,
				"misconfigured",
				`${spec.service} doesn't recognise your app's client id; check it under service settings`,
			);
		}
		// A 5xx, or a refusal that isn't the grant's fault: the run fails, and the grant stands.
		throw new Error(`${spec.service} refused to refresh its access token (${refusalOf(answer)})`);
	}

	async #token(service: Service, form: Record<string, string>): Promise<TokenAnswer> {
		const response = await fetch(this.#endpoint(service).tokenUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams(form),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const body: unknown = await response.json().catch(() => undefined);
		if (response.ok) {
			const tokens = TokenResponse.safeParse(body);
			if (tokens.success) return { ok: true, tokens: tokens.data };
			return { ok: false, status: response.status, error: undefined };
		}
		return { ok: false, status: response.status, error: TokenError.safeParse(body).data?.error };
	}

	#endpoint(service: Service): OAuthEndpoint {
		const endpoint = this.#endpoints[service];
		if (!endpoint) throw new Error(`No OAuth endpoints are known for ${service}`);
		return endpoint;
	}

	/** Removes and returns a started connect, if it is this account's and still fresh. */
	#take(accountId: string, state: string): PendingConnect | undefined {
		const key = accountKey(accountId, state);
		const pending = this.#pending.get(key);
		this.#pending.delete(key);
		if (!pending || this.#now() - pending.startedAt > PENDING_CONNECT_MS) return undefined;
		return pending;
	}

	#forgetExpired(): void {
		for (const [key, pending] of this.#pending) {
			if (this.#now() - pending.startedAt > PENDING_CONNECT_MS) this.#pending.delete(key);
		}
	}
}

/** A map key scoped to one account, so no account reaches another's entry. */
const accountKey = (accountId: string, part: string) => JSON.stringify([accountId, part]);

/** An OAuth error code as shown to the user: only its own characters, never anything else sent. */
const safeCode = (code: string) => code.replace(/[^a-z_]/gi, "").slice(0, 40) || "an error";

const refusalOf = (answer: Extract<TokenAnswer, { ok: false }>) =>
	answer.error ? safeCode(answer.error) : `HTTP ${answer.status}`;
