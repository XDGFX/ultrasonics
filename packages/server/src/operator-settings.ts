import { type OpenDatabase, V1_IMPORT_MARKER_KEY, V1ImportMarker } from "@ultrasonics/db";
import { authStore } from "@ultrasonics/db/auth-store";
import { type Service, withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { Exposure } from "./api.ts";

/**
 * The operator's own app on an `oauth2-pkce` service (ADR-0013 §7): a client ID and never a secret
 * (ADR-0005; spec #136, decision 2).
 */
export const OperatorClient = z.object({
	clientId: withMeta(
		z
			.string()
			.trim()
			.regex(/^[0-9a-fA-F]{32}$/, "A client ID is 32 characters, each 0–9 or a–f"),
		{
			title: "client id",
			description:
				"From your app's page at developer.spotify.com/dashboard. Development mode allows five users, each added under User Management, and the app's owner needs Spotify Premium.",
			placeholder: "32 characters, 0–9 and a–f",
		},
	),
});
export type OperatorClient = z.infer<typeof OperatorClient>;

const clientKey = (service: Service) => `oauth-client:${service}`;
const EXPOSURE_KEY = "exposure";

/**
 * The operator's client credentials, the install's exposure record and the v1 import's marker in
 * `instance_settings`, and nothing else. Writable by the install's account because Phase 1 refuses
 * `AUTH_SOURCE=oauth`, so that account is the operator (spec #134, decision 5).
 */
export function operatorSettings(db: OpenDatabase) {
	const store = authStore(db);
	const v1Import = async () =>
		V1ImportMarker.safeParse(await store.instanceSettings.get(V1_IMPORT_MARKER_KEY)).data;
	return {
		async client(service: Service): Promise<OperatorClient | undefined> {
			const parsed = OperatorClient.safeParse(await store.instanceSettings.get(clientKey(service)));
			return parsed.success ? parsed.data : undefined;
		},
		async registerClient(service: Service, client: OperatorClient): Promise<void> {
			await store.instanceSettings.put(clientKey(service), OperatorClient.parse(client));
		},
		async exposure(): Promise<Exposure | undefined> {
			return Exposure.safeParse(await store.instanceSettings.get(EXPOSURE_KEY)).data;
		},
		/** Keeps the first public request until it is dismissed, so later ones never replace it. */
		async recordExposure(exposure: Exposure): Promise<void> {
			await store.instanceSettings.putIfAbsent(EXPOSURE_KEY, Exposure.parse(exposure));
		},
		async dismissExposure(): Promise<void> {
			await store.instanceSettings.remove(EXPOSURE_KEY);
		},
		/** The v1 importer's marker, or `undefined` when no import ran. */
		v1Import,
		/** Sets `dismissed` and keeps the marker; returns false when no import ran. */
		async dismissV1Import(): Promise<boolean> {
			const marker = await v1Import();
			if (!marker) return false;
			await store.instanceSettings.put(V1_IMPORT_MARKER_KEY, { ...marker, dismissed: true });
			return true;
		},
	};
}

export type OperatorSettings = ReturnType<typeof operatorSettings>;
