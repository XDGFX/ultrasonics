import { z } from "zod";
import { isRecord } from "./record.ts";
import { Service } from "./service.ts";
import type { JSONSchema } from "./settings-form.ts";

/** How a secret is obtained (ADR-0013 §1). Which fields it yields is a separate axis. */
export const Flow = z.enum(["oauth2-pkce", "oauth2", "token", "none"]);
export type Flow = z.infer<typeof Flow>;

type OAuthFlow = Extract<Flow, `oauth2${string}`>;

/** The fields every `oauth2*` flow yields; the SDK supplies them, the plugin never declares them. */
const oauthFields = z.object({ accessToken: z.string() });
const noFields = z.object({});

/** What a plugin declares it needs: never how it is obtained, nor which provider obtains it. */
export type AuthSpec<Fields extends z.ZodObject = z.ZodObject> =
	| { service: Service; flow: "token"; fields: Fields }
	| { service: Service; flow: OAuthFlow; scopes: readonly string[]; fields: Fields }
	| { service: Service; flow: "none"; fields: Fields };

/** What `ctx.auth.get()` resolves to: plain data, inferred from the spec's fields (ADR-0013 §3). */
export type Credentials<Spec extends AuthSpec> = z.output<Spec["fields"]>;

export function defineAuth<Fields extends z.ZodObject>(declaration: {
	service: Service;
	flow: "token";
	fields: Fields;
}): AuthSpec<Fields>;
export function defineAuth(declaration: {
	service: Service;
	flow: OAuthFlow;
	scopes: readonly string[];
}): AuthSpec<typeof oauthFields>;
export function defineAuth(declaration: {
	service: Service;
	flow: "none";
}): AuthSpec<typeof noFields>;
export function defineAuth(
	declaration:
		| { service: Service; flow: "token"; fields: z.ZodObject }
		| { service: Service; flow: OAuthFlow; scopes: readonly string[] }
		| { service: Service; flow: "none" },
): AuthSpec {
	switch (declaration.flow) {
		case "token":
			return declaration;
		case "none":
			return { ...declaration, fields: noFields };
		default:
			return { ...declaration, fields: oauthFields };
	}
}

/**
 * What the UI must collect before `resolve()` can succeed. An empty list means nothing to collect.
 * - `fields`: a token flow's declared fields, as form JSON Schema.
 * - `client`: an `oauth2*` flow whose operator has not registered their own app.
 * - `connect`: an `oauth2*` flow that is ready; the user presses Connect.
 */
export const AuthRequirement = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("fields"), schema: z.custom<JSONSchema>(isRecord) }),
	z.object({ kind: z.literal("client"), service: Service }),
	z.object({ kind: z.literal("connect") }),
]);
export type AuthRequirement = z.infer<typeof AuthRequirement>;

/** The redirect URI is the provider's choice, inside the URL (ADR-0013 §8). */
export const AuthChallenge = z.object({ authoriseUrl: z.string() });
export type AuthChallenge = z.infer<typeof AuthChallenge>;

/**
 * Why credentials could not be resolved. `not-connected`: there is no grant. `reconnect`: a refresh
 * failed or the grant was revoked. `misconfigured`: the operator's client credentials are missing.
 */
export const AuthFailure = z.object({
	service: Service,
	code: z.enum(["not-connected", "reconnect", "misconfigured"]),
	message: z.string(),
});
export type AuthFailure = z.infer<typeof AuthFailure>;

/** Structural, not `instanceof`, so a failure stays recognisable across a clone (ADR-0010 #4). */
export function isAuthFailure(value: unknown): value is AuthFailure {
	return AuthFailure.safeParse(value).success;
}

/**
 * How credentials are obtained, built by the server already bound to one account (ADR-0007), so no
 * method takes an account id. Implementations are not part of the SDK.
 */
export interface AuthProvider {
	/** What the UI must collect before `resolve` can succeed. May be empty. */
	requirements(spec: AuthSpec): AuthRequirement[];
	/**
	 * Credentials for a run, refreshed lazily; rejects with an `AuthFailure`. Plugin code sees them
	 * typed through `ctx.auth.get()`.
	 */
	resolve(spec: AuthSpec): Promise<Credentials<AuthSpec>>;
	/** Token flows: validates `input` against the declared fields and stores the grant. */
	configure(spec: AuthSpec, input: unknown): Promise<void>;
	/** `oauth2*` flows only. */
	begin(spec: AuthSpec): Promise<AuthChallenge>;
	/** `oauth2*` flows only. */
	complete(spec: AuthSpec, callback: unknown): Promise<void>;
}
