import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AccountStore, openDatabase, resolveEncryptionKey } from "@ultrasonics/db";
import { defineAuth, definePlugin } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { fixtureRegistry, holds, plex, registryOf, source } from "../test/fixture-plugins.ts";
import { type Applet, type AppletListing, type RunNowResult, RunSummary } from "./api.ts";
import { type BootResult, boot } from "./boot.ts";
import { DATABASE_FILE, HOSTED_LOGIN_REFUSAL } from "./configuration.ts";
import { eventually, installAccountOf, recordingLogger, runStreamOf } from "./test-support.ts";

const KEY = "ab".repeat(32);
let dataDir: string;
let booted: BootResult | undefined;

afterEach(async () => {
	if (booted?.ok) await booted.stop();
	booted = undefined;
	if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

function env(overrides: Record<string, string | undefined>) {
	dataDir = mkdtempSync(join(tmpdir(), "ultrasonics-server-"));
	return { DATA_DIR: dataDir, PORT: "0", ...overrides };
}

async function bootWith(
	overrides: Record<string, string | undefined>,
	registry = fixtureRegistry,
	logger = recordingLogger(),
) {
	booted = await boot({ env: env(overrides), registry, logger });
	return booted;
}

async function post<T>(url: URL, path: string, body?: object): Promise<T> {
	const response = await fetch(new URL(path, url), {
		method: "POST",
		headers: { "content-type": "application/json" },
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	return response.json() as Promise<T>;
}

/** Creates an applet whose input holds on {@link holds}, and runs it now. */
async function runHeld(url: URL): Promise<{ appletId: string; runId: string }> {
	const { id: appletId } = await post<Applet>(url, "/api/applets", {
		name: "held",
		enabled: true,
		definition: {
			inputs: [{ plugin: "held", settings: {} }],
			modifiers: [],
			outputs: [{ plugin: "sink", settings: {} }],
		},
	});
	const result = await post<RunNowResult>(url, `/api/applets/${appletId}/run`);
	if (result.kind !== "started") throw new Error(`run now answered ${result.kind}`);
	return { appletId, runId: result.runId };
}

/** Uses the database in `dataDir` while no server holds it open for writing. */
async function withStore<T>(read: (store: AccountStore) => Promise<T>): Promise<T> {
	const path = join(dataDir, DATABASE_FILE);
	const key = await resolveEncryptionKey(KEY, path);
	if (!key.ok) throw key.error;
	const db = await openDatabase({ path, encryptionKey: key.key });
	try {
		return await read(db.storeFor(installAccountOf(path)));
	} finally {
		db.close();
	}
}

const storedRun = (runId: string) => withStore((store) => store.runs.get(runId));

const settingsOf = (result: BootResult) => (result.ok ? [] : result.problems.map((p) => p.setting));

describe("configuration", () => {
	test("every unset required setting is explained before boot exits", async () => {
		const result = await bootWith({});
		expect(settingsOf(result)).toEqual(["ENCRYPTION_KEY", "AUTH_SOURCE"]);
	});

	test("an unset ENCRYPTION_KEY prints a fresh key that resolves", async () => {
		const result = await bootWith({ AUTH_SOURCE: "bootstrapped" });
		if (result.ok) throw new Error("booted without a key");
		const fresh = result.problems[0]?.message.match(/[0-9a-f]{64}/)?.[0];
		expect(fresh).toBeDefined();
		expect((await resolveEncryptionKey(fresh, join(dataDir, DATABASE_FILE))).ok).toBe(true);
	});

	test("a malformed setting is refused", async () => {
		const result = await bootWith({ ENCRYPTION_KEY: "short", AUTH_SOURCE: "nobody" });
		expect(settingsOf(result)).toEqual(["ENCRYPTION_KEY", "AUTH_SOURCE"]);
	});

	test("proxy refuses to boot without TRUSTED_PROXIES", async () => {
		const result = await bootWith({ ENCRYPTION_KEY: KEY, AUTH_SOURCE: "proxy" });
		expect(settingsOf(result)).toEqual(["TRUSTED_PROXIES"]);
	});

	test("a TRUSTED_PROXIES entry that is not a CIDR is refused", async () => {
		const result = await bootWith({
			ENCRYPTION_KEY: KEY,
			AUTH_SOURCE: "proxy",
			TRUSTED_PROXIES: "10.0.0.0/8, 300.1.1.1",
		});
		expect(settingsOf(result)).toEqual(["TRUSTED_PROXIES"]);
	});

	test("oauth is a valid source that Phase 1 refuses to boot", async () => {
		const result = await bootWith({ ENCRYPTION_KEY: KEY, AUTH_SOURCE: "oauth" });
		expect(result.ok ? [] : result.problems).toEqual([
			{ setting: "AUTH_SOURCE", message: HOSTED_LOGIN_REFUSAL },
		]);
	});
});

describe("boot", () => {
	test("a run left running by the last process is interrupted, and the count logged", async () => {
		env({});
		const runId = await withStore(async (store) => {
			const applet = await store.applets.create({
				name: "left running",
				definition: {
					inputs: [{ plugin: "source", settings: { playlist: "a" } }],
					modifiers: [],
					outputs: [{ plugin: "plex", settings: {} }],
				},
			});
			return store.runs.start(applet.id, "manual");
		});

		const logger = recordingLogger();
		booted = await boot({
			env: { DATA_DIR: dataDir, PORT: "0", ENCRYPTION_KEY: KEY, AUTH_SOURCE: "bootstrapped" },
			registry: fixtureRegistry,
			logger,
		});
		if (!booted.ok) throw new Error(JSON.stringify(booted.problems));
		const response = await fetch(new URL(`/api/runs/${runId}`, booted.server.url));
		expect(((await response.json()) as { status: string }).status).toBe("interrupted");
		expect(logger.lines.some((line) => line.includes("1 run"))).toBe(true);
	});

	test("a run interrupted at boot keeps one end time, however often it is read", async () => {
		env({});
		const runId = await withStore(async (store) => {
			const applet = await store.applets.create({
				name: "left running",
				definition: {
					inputs: [{ plugin: "source", settings: { playlist: "a" } }],
					modifiers: [],
					outputs: [{ plugin: "plex", settings: {} }],
				},
			});
			return store.runs.start(applet.id, "manual");
		});
		const beforeBoot = Date.now();
		booted = await boot({
			env: { DATA_DIR: dataDir, PORT: "0", ENCRYPTION_KEY: KEY, AUTH_SOURCE: "bootstrapped" },
			registry: fixtureRegistry,
			logger: recordingLogger(),
		});
		if (!booted.ok) throw new Error(JSON.stringify(booted.problems));
		const { url } = booted.server;

		const reads: { finishedAt: number | null; endAt: number | undefined }[] = [];
		for (let read = 0; read < 2; read++) {
			const summary = RunSummary.parse(
				await (await fetch(new URL(`/api/runs/${runId}`, url))).json(),
			);
			const events = await runStreamOf(
				await fetch(new URL(`/api/runs/${runId}/events`, url)),
			).rest();
			reads.push({ finishedAt: summary.finishedAt, endAt: events.at(-1)?.at });
			await Bun.sleep(5);
		}
		const finishedAt = reads[0]?.finishedAt ?? null;
		expect(finishedAt).toBeGreaterThanOrEqual(beforeBoot);
		expect(reads).toEqual([
			{ finishedAt, endAt: finishedAt ?? undefined },
			{ finishedAt, endAt: finishedAt ?? undefined },
		]);
	});

	test("a slot missed while the server was down runs once, on the first tick at boot", async () => {
		env({});
		const hourly = {
			kind: "interval",
			unit: "hour",
			count: 1,
			anchor: "2026-01-01T00:00",
			timeZone: "UTC",
		} as const;
		const appletId = await withStore(async (store) => {
			await store.pluginSettings.put("source", { region: "au" });
			const applet = await store.applets.create({
				name: "missed while down",
				definition: {
					inputs: [{ plugin: "source", settings: { playlist: "a" } }],
					modifiers: [],
					outputs: [{ plugin: "plex", settings: {} }],
				},
			});
			// Three hourly slots ago, so three were missed.
			await store.applets.setSchedule(applet.id, {
				schedule: hourly,
				nextRunAt: Date.now() - 3 * 3_600_000,
			});
			return applet.id;
		});

		booted = await boot({
			env: { DATA_DIR: dataDir, PORT: "0", ENCRYPTION_KEY: KEY, AUTH_SOURCE: "bootstrapped" },
			registry: fixtureRegistry,
			logger: recordingLogger(),
		});
		if (!booted.ok) throw new Error(JSON.stringify(booted.problems));
		const { url } = booted.server;
		await eventually(async () => {
			const response = await fetch(new URL("/api/applets", url));
			const [listing] = (await response.json()) as AppletListing[];
			expect(listing?.state).toBe("idle");
			expect(listing?.lastRun).not.toBeNull();
		});
		const runs = await withStore((store) => store.runs.listForApplet(appletId));
		expect(runs.map((run) => run.trigger)).toEqual(["schedule"]);
	});

	test("a settings schema outside the renderable subset aborts boot with its path", async () => {
		const nested = definePlugin({
			name: "nested",
			description: "A test fixture",
			version: "1.0.0",
			mode: ["playlists"],
			instanceSettings: { inputs: z.object({ deep: z.object({ x: z.string() }) }) },
			run: { inputs: async () => ({ playlists: [] }) },
		});
		const result = await bootWith(
			{ ENCRYPTION_KEY: KEY, AUTH_SOURCE: "bootstrapped" },
			registryOf(source, nested),
		);
		expect(result.ok ? [] : result.problems).toEqual([
			{ setting: "plugins", message: expect.stringMatching(/"nested".*\["deep"\]/) },
		]);
	});

	test("two plugins declaring one service with different specs abort boot", async () => {
		const otherPlex = definePlugin({
			name: "other-plex",
			description: "A test fixture",
			version: "1.0.0",
			mode: ["playlists"],
			auth: defineAuth({
				service: "plex",
				flow: "token",
				fields: z.object({ apiKey: z.string() }),
			}),
			instanceSettings: { outputs: z.object({}) },
			run: { outputs: async () => ({ playlists: [] }) },
		});
		const result = await bootWith(
			{ ENCRYPTION_KEY: KEY, AUTH_SOURCE: "bootstrapped" },
			registryOf(plex, otherPlex),
		);
		expect(result.ok ? [] : result.problems).toEqual([
			{ setting: "plugins", message: expect.stringMatching(/"other-plex".*"plex"/) },
		]);
	});

	test("a stop interrupts a run still going after the grace period, keeping its journal", async () => {
		booted = await boot({
			env: env({ ENCRYPTION_KEY: KEY, AUTH_SOURCE: "bootstrapped" }),
			registry: fixtureRegistry,
			logger: recordingLogger(),
			shutdownGraceMs: 0,
		});
		if (!booted.ok) throw new Error(JSON.stringify(booted.problems));
		const { runId } = await runHeld(booted.server.url);
		const hold = await holds.next();

		await booted.stop();
		booted = undefined;
		hold.release();

		const run = await storedRun(runId);
		expect(run?.status).toBe("interrupted");
		expect(run?.stages).toEqual([
			expect.objectContaining({ type: "stage", plugin: "held", state: "started" }),
			expect.objectContaining({ type: "end", status: "interrupted" }),
		]);
	});

	test("a configured boot listens and serves the API", async () => {
		const result = await bootWith({ ENCRYPTION_KEY: KEY, AUTH_SOURCE: "bootstrapped" });
		if (!result.ok) throw new Error(JSON.stringify(result.problems));
		const response = await fetch(new URL("/api/instance", result.server.url));
		expect(await response.json()).toEqual({ exposed: false });
	});
});
