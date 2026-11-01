import { asc, eq } from "drizzle-orm";
import { connectionOf, type OpenDatabase } from "./connection.ts";
import type { JsonValue } from "./json.ts";
import { accounts, instanceSettings } from "./schema.ts";

/**
 * The narrow auth store (ADR-0009 §4): the install's account and operator-owned instance settings.
 * Lint allows this subpath only in the session middleware and boot.
 */
export function authStore(handle: OpenDatabase) {
	const { db } = connectionOf(handle);
	return {
		/** The install's one account: the first created, which the open step guarantees exists. */
		async installAccount(): Promise<string> {
			const row = db
				.select({ id: accounts.id })
				.from(accounts)
				.orderBy(asc(accounts.createdAt), asc(accounts.id))
				.limit(1)
				.get();
			if (!row) throw new Error("No account exists; the database was not opened by openDatabase");
			return row.id;
		},
		instanceSettings: {
			async get(key: string): Promise<JsonValue | undefined> {
				return db
					.select({ value: instanceSettings.value })
					.from(instanceSettings)
					.where(eq(instanceSettings.key, key))
					.get()?.value;
			},
			async put(key: string, value: JsonValue): Promise<void> {
				db.insert(instanceSettings)
					.values({ key, value })
					.onConflictDoUpdate({ target: instanceSettings.key, set: { value } })
					.run();
			},
		},
	};
}

export type AuthStore = ReturnType<typeof authStore>;
