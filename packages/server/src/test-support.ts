import { Database as Sqlite } from "bun:sqlite";
import { afterEach, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunQueue, RunEvent } from "@ultrasonics/core";
import { type OpenDatabase, openDatabase, resolveEncryptionKey } from "@ultrasonics/db";
import type { PluginRegistry } from "@ultrasonics/plugin-sdk";
import type { z } from "zod";
import { fixtureRegistry } from "../test/fixture-plugins.ts";
import { type App, createApp } from "./app.ts";
import type { PkceFlow } from "./auth/pkce-flow.ts";
import { loadCatalogue } from "./catalogue.ts";
import type { BootableAuthSource } from "./configuration.ts";
import { DATABASE_FILE } from "./configuration.ts";
import { parseIpRange } from "./ip-range.ts";
import type { Logger } from "./logger.ts";
import type { Scheduler } from "./scheduler.ts";

/** A logger that keeps every line, prefixed with its level, for a test to read. */
export function recordingLogger(): Logger & { lines: string[] } {
	const lines: string[] = [];
	return {
		lines,
		info: (message) => lines.push(`info: ${message}`),
		warn: (message) => lines.push(`warn: ${message}`),
		error: (message) => lines.push(`error: ${message}`),
	};
}

/** The one account a freshly opened database holds, read straight from the file. */
export function installAccountOf(path: string): string {
	const sqlite = new Sqlite(path, { strict: true, readonly: true });
	try {
		const row = sqlite.query("SELECT id FROM accounts ORDER BY created_at, id LIMIT 1").get() as {
			id: string;
		};
		return row.id;
	} finally {
		sqlite.close();
	}
}

/** The header a test sets to say which address its request comes from. */
export const CLIENT_ADDRESS_HEADER = "x-test-client-address";

export const TEST_KEY_HEX = "0".repeat(64);

export interface TestAppOptions {
	authSource?: BootableAuthSource;
	trustedProxies?: string[];
	registry?: PluginRegistry;
	webRoot?: string;
	pkce?: PkceFlow;
}

export interface TestApp {
	app: App;
	db: OpenDatabase;
	dataDir: string;
	/** The install's account, which every session resolves to. */
	mine: string;
	/** A second account seeded straight into the database, which no route may reach. */
	theirs: string;
	logger: ReturnType<typeof recordingLogger>;
	/** The app's clock, in epoch milliseconds, which only the test moves. */
	clock: { now: number };
	/** The app's scheduler, never started: a test ticks it. */
	scheduler: Scheduler;
	/** Runs `use` on a raw connection to the database file, bypassing every module. */
	raw<T>(use: (sqlite: Sqlite) => T): T;
	/**
	 * Serves the app on a real port, for what `app.request()` can't hold open, and returns a `GET`
	 * against it from a LAN address. The server stops after the test.
	 */
	listen(): (path: string, headers?: Record<string, string>) => Promise<Response>;
	/** A request as the UI makes it: JSON in, from a LAN address unless the headers say otherwise. */
	call(
		method: string,
		path: string,
		body?: unknown,
		headers?: Record<string, string>,
	): Promise<Response>;
}

/**
 * Builds the app in-process against a real database in a fresh temporary directory, holding the
 * install's account and a second one, and cleans up after each test.
 */
export function useTestApp(): (options?: TestAppOptions) => Promise<TestApp> {
	const opened: { db: OpenDatabase; dir: string }[] = [];
	const servers: Bun.Server<undefined>[] = [];
	afterEach(() => {
		for (const server of servers.splice(0)) server.stop(true);
		for (const { db, dir } of opened.splice(0)) {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
	return async (options = {}) => {
		const dataDir = mkdtempSync(join(tmpdir(), "ultrasonics-server-"));
		const path = join(dataDir, DATABASE_FILE);
		const key = await resolveEncryptionKey(TEST_KEY_HEX, path);
		if (!key.ok) throw key.error;
		const db = await openDatabase({ path, encryptionKey: key.key });
		opened.push({ db, dir: dataDir });
		const raw = <T>(use: (sqlite: Sqlite) => T): T => {
			const sqlite = new Sqlite(path, { strict: true });
			try {
				return use(sqlite);
			} finally {
				sqlite.close();
			}
		};
		const mine = installAccountOf(path);
		const theirs = Bun.randomUUIDv7();
		raw((sqlite) =>
			sqlite
				.query("INSERT INTO accounts (id, created_at) VALUES (?, ?)")
				.run(theirs, Date.now() + 1),
		);
		const registry = options.registry ?? fixtureRegistry;
		const catalogue = await loadCatalogue(registry);
		if (!catalogue.ok) throw new Error(catalogue.problems.join("\n"));
		const logger = recordingLogger();
		const clock = { now: Date.now() };
		const { app, scheduler } = await createApp({
			configuration: {
				authSource: options.authSource ?? "bootstrapped",
				trustedProxies: (options.trustedProxies ?? []).flatMap((text) => parseIpRange(text) ?? []),
				proxyUserHeader: "Remote-User",
				dataDir,
			},
			db,
			registry,
			catalogue: catalogue.catalogue,
			queue: createRunQueue(),
			clientAddress: (c) => c.req.header(CLIENT_ADDRESS_HEADER),
			logger,
			webRoot: options.webRoot ?? join(dataDir, "no-web-root"),
			...(options.pkce ? { pkce: options.pkce } : {}),
			now: () => clock.now,
		});
		return {
			app,
			db,
			dataDir,
			mine,
			theirs,
			logger,
			clock,
			scheduler,
			raw,
			listen: () => {
				const server = Bun.serve({ port: 0, fetch: app.fetch });
				servers.push(server);
				return (path, headers = {}) =>
					fetch(new URL(path, server.url), {
						headers: { [CLIENT_ADDRESS_HEADER]: "192.168.1.20", ...headers },
					});
			},
			call: async (method, path, body, headers = {}) =>
				app.request(path, {
					method,
					headers: {
						[CLIENT_ADDRESS_HEADER]: "192.168.1.20",
						...(body === undefined && method === "GET"
							? {}
							: { "Content-Type": "application/json" }),
						...headers,
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
		};
	};
}

/** Parses a response body with its `@ultrasonics/server/api` schema, which must accept it. */
export async function bodyOf<T extends z.ZodType>(
	response: Response,
	schema: T,
): Promise<z.output<T>> {
	const text = await response.text();
	expect(text).not.toMatch(/accountId|webhookTokenHash|account_id|webhook_token_hash/);
	return schema.parse(JSON.parse(text));
}

/** A run stream read as the browser's `EventSource` reads it, checking each `id` is its `seq`. */
export function runStreamOf(response: Response) {
	if (!response.body) throw new Error("the run stream has no body");
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";

	/** The next event, or `undefined` once the server closes the stream. Comments are skipped. */
	async function next(): Promise<RunEvent | undefined> {
		for (;;) {
			const end = buffer.indexOf("\n\n");
			if (end >= 0) {
				const lines = buffer.slice(0, end).split("\n");
				buffer = buffer.slice(end + 2);
				const field = (name: string) =>
					lines
						.find((line) => line.startsWith(`${name}:`))
						?.slice(name.length + 1)
						.trim();
				const data = field("data");
				if (data === undefined) continue;
				const event = RunEvent.parse(JSON.parse(data));
				expect(field("id")).toBe(String(event.seq));
				return event;
			}
			const { value, done } = await reader.read();
			if (done) return undefined;
			buffer += value;
		}
	}

	return {
		next,
		/** Every event up to and including the first that `stop` accepts. */
		async until(stop: (event: RunEvent) => boolean): Promise<RunEvent[]> {
			const events: RunEvent[] = [];
			for (;;) {
				const event = await next();
				if (!event) throw new Error(`the stream closed after ${events.length} events`);
				events.push(event);
				if (stop(event)) return events;
			}
		},
		/** Every event until the server closes the stream. */
		async rest(): Promise<RunEvent[]> {
			const events: RunEvent[] = [];
			for (let event = await next(); event; event = await next()) events.push(event);
			return events;
		},
		/**
		 * Drops the connection, as a browser losing the network would. Not awaited: the cancel can
		 * settle only once the server notices.
		 */
		close: () => void reader.cancel(),
	};
}

/** Retries `check` until it stops throwing, for state another task writes. */
export async function eventually(check: () => Promise<void> | void): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await check();
		} catch (error) {
			if (attempt >= 100) throw error;
			await Bun.sleep(10);
		}
	}
}
