import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { AccountStore } from "./account-store.ts";
import type { EncryptionKey } from "./encryption-key.ts";
import type * as schema from "./schema.ts";

export interface Connection {
	readonly db: BunSQLiteDatabase<typeof schema>;
	readonly encryptionKey: EncryptionKey;
}

/** What the open step hands back. The connection behind it is reachable only inside this package. */
export interface OpenDatabase {
	storeFor(accountId: string): AccountStore;
	close(): void;
}

const connections = new WeakMap<OpenDatabase, Connection>();

export function register(handle: OpenDatabase, connection: Connection): void {
	connections.set(handle, connection);
}

export function connectionOf(handle: OpenDatabase): Connection {
	const connection = connections.get(handle);
	if (!connection) throw new Error("Not a handle returned by openDatabase, or already closed");
	return connection;
}

/** Returns whether the handle was still open. */
export function forget(handle: OpenDatabase): boolean {
	return connections.delete(handle);
}
