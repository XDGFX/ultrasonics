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

/** A route asked a flow for something it doesn't have, such as a token service's redirect URI. */
export class FlowMismatchError extends Error {
	override readonly name = "FlowMismatchError";
}

/** An `oauth2*` step this provider does not implement yet. */
export class NotYetAvailableError extends Error {
	override readonly name = "NotYetAvailableError";
}

const isOAuth = (spec: AuthSpec) => spec.flow === "oauth2" || spec.flow === "oauth2-pkce";

function formOf(schema: Parameters<typeof toFormSchema>[0]): JSONSchema {
	const result = toFormSchema(schema, { auth: true });
	// Boot converted every declared schema already, so this is a build bug.
	if (!result.ok) throw new Error(`Unrenderable auth form: ${JSON.stringify(result.issues)}`);
	return result.jsonSchema;
}

const CLIENT_FORM = formOf(OperatorClient);

const failure = (service: Service, code: AuthFailure["code"], message: string): AuthFailure => ({
	service,
	code,
	message,
});

/**
 * The self-host provider, bound to one account (ADR-0007 §4). Core sees only `AuthProvider`; the
 * routes also call `redirectUri`, `clientForm`, `registerClient` and `status`, which core never
 * needs (spec #134, decision 6).
 */
export class LocalAuthProvider implements AuthProvider {
	constructor(
		private readonly store: AccountStore,
		private readonly operator: OperatorSettings,
		/** Services whose operator has registered a client, read before construction. */
		private readonly registeredClients: ReadonlySet<Service>,
	) {}

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
			default:
				throw this.oauthNotYet(spec);
		}
	}

	async resolve(spec: AuthSpec): Promise<Credentials<AuthSpec>> {
		if (spec.flow === "none") return {};
		if (isOAuth(spec)) throw this.oauthNotYet(spec);
		const grant = await this.store.credentials.get(spec.service);
		if (!grant) {
			throw failure(spec.service, "not-connected", `${spec.service} is not connected`);
		}
		return grant.document;
	}

	async configure(spec: AuthSpec, input: unknown): Promise<void> {
		if (spec.flow !== "token") {
			throw new FlowMismatchError(`${spec.service} does not take pasted credentials`);
		}
		await this.store.credentials.put(
			spec.service,
			JsonObject.parse(spec.fields.parse(input)),
			null,
		);
	}

	async begin(spec: AuthSpec): Promise<AuthChallenge> {
		throw isOAuth(spec) ? this.oauthNotYet(spec) : this.notOAuth(spec);
	}

	async complete(spec: AuthSpec, _callback: unknown): Promise<void> {
		throw isOAuth(spec) ? this.oauthNotYet(spec) : this.notOAuth(spec);
	}

	/** Where the service sends the user back: the SPA's wizard route on the wizard's origin. */
	redirectUri(spec: AuthSpec, origin: string): string {
		if (!isOAuth(spec)) throw this.notOAuth(spec);
		return `${origin}/services/${spec.service}`;
	}

	/** The fixed form for the operator's own app on an `oauth2*` service. */
	clientForm(spec: AuthSpec): JSONSchema {
		if (!isOAuth(spec)) throw this.notOAuth(spec);
		return CLIENT_FORM;
	}

	async registerClient(spec: AuthSpec, input: unknown): Promise<ValidationIssue[]> {
		if (!isOAuth(spec)) throw this.notOAuth(spec);
		const parsed = OperatorClient.safeParse(input);
		if (!parsed.success) return issuesOf(parsed.error);
		await this.operator.registerClient(spec.service, parsed.data);
		return [];
	}

	/** From stored state alone: no network call, and no refresh (spec #134, decision 6). */
	async status(spec: AuthSpec): Promise<ServiceStatus["status"]> {
		if (spec.flow === "none") return { kind: "connected" };
		// A key mismatch throws here, loudly: it is the operator's problem, never a reconnect.
		const grant = await this.store.credentials.get(spec.service);
		if (!grant) return { kind: "not-connected" };
		if (isOAuth(spec) && !this.registeredClients.has(spec.service)) {
			return {
				kind: "failed",
				failure: failure(
					spec.service,
					"misconfigured",
					`Register your own ${spec.service} app before connecting`,
				),
			};
		}
		return { kind: "connected" };
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
	store: AccountStore,
	operator: OperatorSettings,
	services: Iterable<Service>,
): Promise<LocalAuthProvider> {
	const registered = new Set<Service>();
	for (const service of services) {
		if (await operator.client(service)) registered.add(service);
	}
	return new LocalAuthProvider(store, operator, registered);
}
