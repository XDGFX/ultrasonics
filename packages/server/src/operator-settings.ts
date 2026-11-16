import type { OpenDatabase } from "@ultrasonics/db";
import { authStore } from "@ultrasonics/db/auth-store";
import type { Service } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** The operator's own app on a service, which BYO `oauth2*` flows need (ADR-0013 §7). */
export const OperatorClient = z.object({ clientId: z.string().trim().min(1) });
export type OperatorClient = z.infer<typeof OperatorClient>;

const clientKey = (service: Service) => `oauth-client:${service}`;

/**
 * The operator's client credentials in `instance_settings`, and nothing else. Writable by the
 * install's account because Phase 1 refuses `AUTH_SOURCE=oauth`, so that account is the operator
 * (spec #134, decision 5).
 */
export function operatorSettings(db: OpenDatabase) {
	const store = authStore(db);
	return {
		async client(service: Service): Promise<OperatorClient | undefined> {
			const parsed = OperatorClient.safeParse(await store.instanceSettings.get(clientKey(service)));
			return parsed.success ? parsed.data : undefined;
		},
		async registerClient(service: Service, client: OperatorClient): Promise<void> {
			await store.instanceSettings.put(clientKey(service), OperatorClient.parse(client));
		},
	};
}

export type OperatorSettings = ReturnType<typeof operatorSettings>;
