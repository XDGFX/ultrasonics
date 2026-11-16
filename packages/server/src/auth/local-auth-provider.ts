import { type AccountStore, JsonObject } from "@ultrasonics/db";
import {
	type AuthChallenge,
	type AuthFailure,
	type AuthProvider,
	type AuthRequirement,
	type AuthSpec,
	type Credentials,
	issuesOf,
	type JSONSchema,
	type Service,
	toFormSchema,
	type ValidationIssue,
} from "@ultrasonics/plugin-sdk";
import type { ServiceStatus } from "../api.ts";
import { OperatorClient, type OperatorSettings } from "../operator-settings.ts";
import {
	authFailure,
	checkGrant,
	noClientFailure,
	type PkceFlow,
	redirectUriFor,
} from "./pkce-flow.ts";

/** A route asked a flow for something it doesn't have, such as a token service's redirect URI. */
export class FlowMismatchError extends Error {
	override readonly name = "FlowMismatchError";
}

/** An `oauth2*` step this provider does not implement yet. */
export class NotYetAvailableError extends Error {
	override readonly name = "NotYetAvailableError";
}

/**
 * An `AuthFailure` a route throws: an `Error`, so Hono's error handler sees it, and still an
 * `AuthFailure` structurally.
 */
export class AuthFailureError extends Error implements AuthFailure {
	override readonly name = "AuthFailureError";
	constructor(
		readonly service: Service,
		readonly code: AuthFailure["code"],
		message: string,
	) {
		super(message);
	}
}

const isOAuth = (spec: AuthSpec) => spec.flow === "oauth2" || spec.flow === "oauth2-pkce";

function formOf(schema: Parameters<typeof toFormSchema>[0]): JSONSchema {
	const result = toFormSchema(schema, { auth: true });
	// Boot converted every declared schema already, so this is a build bug.
	if (!result.ok) throw new Error(`Unrenderable auth form: ${JSON.stringify(result.issues)}`);
	return result.jsonSchema;
}

const CLIENT_FORM = formOf(OperatorClient);

export interface LocalAuthProviderDeps {
	accountId: string;
	store: AccountStore;
	operator: OperatorSettings;
	/** The operator's registered clients, read before construction. */
	clients: ReadonlyMap<Service, OperatorClient>;
	/** The server's one PKCE flow, shared by every provider it builds. */
	pkce: PkceFlow;
	/** The wizard's origin, which `begin` builds the redirect URI from; routes pass it. */
	origin?: string;
}

/**
 * The self-host provider, bound to one account (ADR-0007 §4). Core sees only `AuthProvider`; the
 * routes also call `redirectUri`, `clientForm`, `registerClient` and `status`, which core never
 * needs (spec #134, decision 6).
 */
export class LocalAuthProvider implements AuthProvider {
	constructor(private readonly deps: LocalAuthProviderDeps) {}

	requirements(spec: AuthSpec): AuthRequirement[] {
		switch (spec.flow) {
			case "token": {
				const schema = formOf(spec.fields);
				return Object.keys(schema.properties ?? {}).length === 0
					? []
					: [{ kind: "fields", schema }];
			}
			case "none":
				return [];
			case "oauth2-pkce":
				this.pkceOnly(spec);
				return this.deps.clients.has(spec.service)
					? [{ kind: "connect" }]
					: [{ kind: "client", service: spec.service }, { kind: "connect" }];
			default:
				throw this.oauthNotYet(spec);
		}
	}

	async resolve(spec: AuthSpec): Promise<Credentials<AuthSpec>> {
		if (spec.flow === "none") return {};
		const { accountId, store, clients, pkce } = this.deps;
		if (isOAuth(spec)) {
			this.pkceOnly(spec);
			return pkce.resolve(accountId, spec, store, clients.get(spec.service)?.clientId);
		}
		const grant = await store.credentials.get(spec.service);
		if (!grant) {
			throw authFailure(spec.service, "not-connected", `${spec.service} is not connected`);
		}
		return grant.document;
	}

	async configure(spec: AuthSpec, input: unknown): Promise<void> {
		if (spec.flow !== "token") {
			throw new FlowMismatchError(`${spec.service} does not take pasted credentials`);
		}
		await this.deps.store.credentials.put(
			spec.service,
			JsonObject.parse(spec.fields.parse(input)),
			null,
		);
	}

	async begin(spec: AuthSpec): Promise<AuthChallenge> {
		if (!isOAuth(spec)) throw this.notOAuth(spec);
		this.pkceOnly(spec);
		const { accountId, clients, pkce, origin } = this.deps;
		const client = clients.get(spec.service);
		if (!client) {
			const { code, message } = noClientFailure(spec.service);
			throw new AuthFailureError(spec.service, code, message);
		}
		if (origin === undefined) throw new Error("begin() needs the wizard's origin");
		return pkce.begin(accountId, spec, client.clientId, this.redirectUri(spec, origin));
	}

	async complete(spec: AuthSpec, callback: unknown): Promise<void> {
		if (!isOAuth(spec)) throw this.notOAuth(spec);
		this.pkceOnly(spec);
		const { accountId, store, pkce } = this.deps;
		await pkce.complete(accountId, spec, store, callback);
	}

	/** Where the service sends the user back, under its redirect URI rule (spec #136, decision 1). */
	redirectUri(spec: AuthSpec, origin: string): string {
		if (!isOAuth(spec)) throw this.notOAuth(spec);
		return redirectUriFor(spec.service, origin);
	}

	/** The fixed form for the operator's own app on an `oauth2-pkce` service: a client ID only. */
	clientForm(spec: AuthSpec): JSONSchema {
		if (!isOAuth(spec)) throw this.notOAuth(spec);
		this.pkceOnly(spec);
		return CLIENT_FORM;
	}

	async registerClient(spec: AuthSpec, input: unknown): Promise<ValidationIssue[]> {
		if (!isOAuth(spec)) throw this.notOAuth(spec);
		this.pkceOnly(spec);
		const parsed = OperatorClient.safeParse(input);
		if (!parsed.success) return issuesOf(parsed.error);
		await this.deps.operator.registerClient(spec.service, parsed.data);
		return [];
	}

	/** From stored state alone: no network call, and no refresh (spec #134, decision 6). */
	async status(spec: AuthSpec): Promise<ServiceStatus["status"]> {
		if (spec.flow === "none") return { kind: "connected" };
		// A key mismatch throws here, loudly: it is the operator's problem, never a reconnect.
		const grant = await this.deps.store.credentials.get(spec.service);
		if (!grant) return { kind: "not-connected" };
		if (!isOAuth(spec)) return { kind: "connected" };
		const client = this.deps.clients.get(spec.service);
		if (!client) return { kind: "failed", failure: noClientFailure(spec.service) };
		const checked = checkGrant(spec, grant.document, client.clientId);
		return checked.ok
			? { kind: "connected" }
			: { kind: "failed", failure: authFailure(spec.service, "reconnect", checked.reason) };
	}

	/** `oauth2` with a client secret waits for a plugin that needs it (spec #136, decision 2). */
	private pkceOnly(spec: AuthSpec): void {
		if (spec.flow !== "oauth2-pkce" || !this.deps.pkce.supports(spec.service)) {
			throw this.oauthNotYet(spec);
		}
	}

	private notOAuth(spec: AuthSpec): FlowMismatchError {
		return new FlowMismatchError(`${spec.service} does not connect through OAuth`);
	}

	private oauthNotYet(spec: AuthSpec): NotYetAvailableError {
		return new NotYetAvailableError(
			`Connecting ${spec.service} through OAuth is not available yet`,
		);
	}
}

/**
 * Builds the provider for one account. Async because `requirements` is synchronous while the
 * operator's clients live in the database, so they are read first.
 */
export async function createLocalAuthProvider(
	deps: Omit<LocalAuthProviderDeps, "clients" | "store"> & {
		db: { storeFor(accountId: string): AccountStore };
		services: Iterable<Service>;
	},
): Promise<LocalAuthProvider> {
	const { db, services, ...rest } = deps;
	const clients = new Map<Service, OperatorClient>();
	for (const service of services) {
		const client = await deps.operator.client(service);
		if (client) clients.set(service, client);
	}
	return new LocalAuthProvider({ ...rest, store: db.storeFor(deps.accountId), clients });
}
