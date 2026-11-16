import { Database as Sqlite } from "bun:sqlite";
import { afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OpenDatabase, openDatabase, resolveEncryptionKey } from "@ultrasonics/db";
import { definePlugin, type Plugin } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { importWith, type V1ImportOptions } from "./import-v1.ts";
import type { Mapping } from "./mapping.ts";
import { convertV1Filter } from "./v1-filter.ts";

const FIXTURES = join(import.meta.dir, "..", "test", "fixtures");

/** A token the fixture v1 database holds, which must never reach the report or the log. */
export const RECOGNISABLE_TOKEN = "RECOGNISABLE-TOKEN-1f2e";

const handshake = { description: "A test fixture", version: "1.0.0" } as const;

const source = definePlugin({
	...handshake,
	name: "source",
	mode: ["playlists"],
	persistentSettings: z.object({ region: z.enum(["au", "gb"]) }),
	instanceSettings: { inputs: z.object({ playlist: z.string().min(1), filter: z.string() }) },
	run: {
		async inputs() {
			return { playlists: [] };
		},
	},
});

const sink = definePlugin({
	...handshake,
	name: "sink",
	mode: ["playlists"],
	instanceSettings: { outputs: z.object({ library: z.string().min(1) }) },
	run: {
		async outputs() {
			return { playlists: [] };
		},
	},
});

export const fixturePlugins: ReadonlyMap<string, Plugin> = new Map<string, Plugin>([
	["source", source],
	["sink", sink],
]);

/** Thrown by the sink mapping for data holding `explode`. */
export const EXPLOSION = "the sink mapping exploded";

/** Mapping modules for the fixture's `fixture source` and `fixture sink`, as a plugin ticket writes one. */
export const fixtureMappings: readonly Mapping<string>[] = [
	{
		plugin: "source",
		accepts: (name, version) => name === "fixture source" && ["0.9", "1.0"].includes(version),
		setup: { reconnect: "Fixture" },
		persistent: (v1) => ({
			value: { region: v1.region ?? null },
			...(typeof v1.token === "string"
				? { grant: { service: "fixture", fields: { token: v1.token } } }
				: {}),
		}),
		instance: (_, v1) => {
			const pattern = typeof v1.filter === "string" ? v1.filter : "";
			const converted = convertV1Filter(pattern, "search");
			return converted.ok
				? {
						settings: { playlist: v1.playlist ?? "", filter: converted.filter },
						notes: converted.notes,
					}
				: {
						settings: { playlist: v1.playlist ?? "", filter: pattern },
						manualEdits: [{ pattern, reason: converted.reason }],
					};
		},
	},
	{
		plugin: "sink",
		accepts: (name, version) => name === "fixture sink" && version === "1.0",
		instance: (_, v1) => {
			if ("explode" in v1) throw new Error(EXPLOSION);
			return { settings: { library: v1.library ?? "" } };
		},
	},
];

/** Builds a v1 database at `path` from a fixture `.sql` file. */
export function buildV1Database(path: string, fixture = "v1-install.sql"): void {
	const sqlite = new Sqlite(path, { create: true });
	try {
		sqlite.run(readFileSync(join(FIXTURES, fixture), "utf8"));
	} finally {
		sqlite.close();
	}
}

export function recordingLogger() {
	const lines: { level: "info" | "warn" | "error"; message: string }[] = [];
	return {
		lines,
		info: (message: string) => lines.push({ level: "info", message }),
		warn: (message: string) => lines.push({ level: "warn", message }),
		error: (message: string) => lines.push({ level: "error", message }),
	};
}

export interface ImportHarness {
	dataDir: string;
	v1Path: string;
	v2Path: string;
	db: OpenDatabase;
	logger: ReturnType<typeof recordingLogger>;
	run(
		overrides?: Partial<V1ImportOptions>,
		mappings?: readonly Mapping<string>[],
	): ReturnType<typeof importWith>;
}

/** A fresh data directory with an open v2 database, removed after each test. */
export function useImport(): () => Promise<ImportHarness> {
	let cleanup: (() => void) | undefined;
	afterEach(() => {
		cleanup?.();
		cleanup = undefined;
	});
	return async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "ultrasonics-v1-import-"));
		const v2Path = join(dataDir, "ultrasonics-v2.db");
		const key = await resolveEncryptionKey("cd".repeat(32), v2Path);
		if (!key.ok) throw key.error;
		const db = await openDatabase({ path: v2Path, encryptionKey: key.key });
		cleanup = () => {
			db.close();
			rmSync(dataDir, { recursive: true, force: true });
		};
		const logger = recordingLogger();
		return {
			dataDir,
			v1Path: join(dataDir, "ultrasonics.db"),
			v2Path,
			db,
			logger,
			run: (overrides = {}, mappings = fixtureMappings) =>
				importWith(
					{
						db,
						plugins: fixturePlugins,
						dataDir,
						env: {},
						authSource: "bootstrapped",
						logger,
						now: () => Date.UTC(2026, 10, 16, 2, 48, 52),
						...overrides,
					},
					mappings,
				),
		};
	};
}
