import { eq } from "drizzle-orm";
import { AppletDefinition } from "./applet-definition.ts";
import { connectionOf, type OpenDatabase } from "./connection.ts";
import { CURRENT_KEY_VERSION, encryptCredential } from "./credential-cipher.ts";
import { JsonObject, JsonValue } from "./json.ts";
import { Schedule } from "./schedule.ts";
import { accounts, applets, credentials, instanceSettings, pluginSettings } from "./schema.ts";

/** The `instance_settings` key whose presence means the v1 import has run (ADR-0017 §1). */
const MARKER_KEY = "v1_import";

/** Everything one v1 import writes, for one account, beside its marker. */
export interface V1ImportWrite {
	accountId: string;
	applets: { name: string; definition: AppletDefinition; schedule: Schedule | null }[];
	pluginSettings: { plugin: string; value: JsonValue }[];
	grants: { service: string; document: JsonObject }[];
	marker: JsonValue;
}

/**
 * The v1 importer's narrow module (#177): it writes account rows and the operator-owned marker in
 * one transaction, which the scoped store cannot. Lint allows this subpath only in the importer.
 */
export function v1ImportStore(handle: OpenDatabase) {
	const { db, encryptionKey } = connectionOf(handle);
	const readMarker = (tx: Pick<typeof db, "select"> = db) =>
		tx
			.select({ value: instanceSettings.value })
			.from(instanceSettings)
			.where(eq(instanceSettings.key, MARKER_KEY))
			.get()?.value;

	return {
		/** At most two account ids: enough to tell whether the install has exactly one. */
		async accountIds(): Promise<string[]> {
			return db
				.select({ id: accounts.id })
				.from(accounts)
				.limit(2)
				.all()
				.map((row) => row.id);
		},

		async marker(): Promise<JsonValue | undefined> {
			return readMarker();
		},

		/**
		 * Writes every applet disabled and unscheduled to run, then the settings, grants and marker.
		 * An imported setting or grant replaces one v2 already holds, as the report says it was
		 * imported. Returns false, writing nothing, when the marker already exists.
		 */
		async commit(write: V1ImportWrite): Promise<boolean> {
			const sealed = await Promise.all(
				write.grants.map(async ({ service, document }) => ({
					service,
					secret: await encryptCredential(encryptionKey, JsonObject.parse(document)),
				})),
			);
			const now = Date.now();
			return db.transaction((tx) => {
				if (readMarker(tx) !== undefined) return false;
				const { accountId } = write;
				for (const [index, applet] of write.applets.entries()) {
					tx.insert(applets)
						.values({
							id: Bun.randomUUIDv7(),
							accountId,
							name: applet.name,
							enabled: false,
							definition: AppletDefinition.parse(applet.definition),
							schedule: applet.schedule && Schedule.parse(applet.schedule),
							nextRunAt: null,
							// A millisecond apart, so the applets list in v1's order.
							createdAt: now + index,
							updatedAt: now + index,
						})
						.run();
				}
				for (const { plugin, value } of write.pluginSettings) {
					const parsed = JsonValue.parse(value);
					tx.insert(pluginSettings)
						.values({ accountId, plugin, value: parsed })
						.onConflictDoUpdate({
							target: [pluginSettings.accountId, pluginSettings.plugin],
							set: { value: parsed },
						})
						.run();
				}
				for (const { service, secret } of sealed) {
					const columns = { expiresAt: null, keyVersion: CURRENT_KEY_VERSION, secret };
					tx.insert(credentials)
						.values({ accountId, service, ...columns })
						.onConflictDoUpdate({
							target: [credentials.accountId, credentials.service],
							set: columns,
						})
						.run();
				}
				tx.insert(instanceSettings)
					.values({ key: MARKER_KEY, value: JsonValue.parse(write.marker) })
					.run();
				return true;
			});
		},
	};
}

export type V1ImportStore = ReturnType<typeof v1ImportStore>;
