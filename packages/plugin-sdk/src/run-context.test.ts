import { describe, expect, test } from "bun:test";
import {
	type AuthFailure,
	createRunContext,
	createTestContext,
	type HostPort,
	isAuthFailure,
	type LogEntry,
	type RunPayload,
	SongDict,
} from "./index.ts";

function recordingPort(credentials: () => Promise<unknown>) {
	const logs: LogEntry[] = [];
	const port: HostPort = { credentials, log: (entry) => logs.push(entry) };
	return { port, logs };
}

const songs = SongDict.parse({ playlists: [{ name: "Focus", songs: [] }] });

const outputPayload: RunPayload = {
	component: "outputs",
	appletId: "applet-1",
	runId: "run-7",
	deadlineMs: 1_800_000_000_000,
	configDir: "/config/plugins/example",
	persistent: { prefix: "" },
	instance: { existing: "append" },
	songs,
};

const withAuth = { declaresAuth: true };
const withoutAuth = { declaresAuth: false };

describe("createRunContext", () => {
	test("gives a plugin that declares no auth no auth facade", () => {
		const { port } = recordingPort(async () => ({}));
		expect(createRunContext(outputPayload, port, withoutAuth)).not.toHaveProperty("auth");
	});

	test("carries the payload's data onto the context", () => {
		const { port } = recordingPort(async () => ({}));
		const ctx = createRunContext(outputPayload, port, withAuth);
		expect(ctx).toMatchObject({
			appletId: "applet-1",
			runId: "run-7",
			deadlineMs: 1_800_000_000_000,
			configDir: "/config/plugins/example",
			persistent: { prefix: "" },
			instance: { existing: "append" },
			songs,
		});
	});

	test("gives an input no song dict", () => {
		const { port } = recordingPort(async () => ({}));
		const { songs: _, ...rest } = outputPayload;
		const ctx = createRunContext({ ...rest, component: "inputs" }, port, withAuth);
		expect(ctx).not.toHaveProperty("songs");
	});

	test("sends each log line to the sink, attributed to the run", () => {
		const { port, logs } = recordingPort(async () => ({}));
		const ctx = createRunContext(outputPayload, port, withAuth);
		ctx.log.debug("connecting");
		ctx.log.info("found 3 playlists");
		ctx.log.warn("skipping a local file");
		ctx.log.error("server said 500");
		expect(logs).toEqual([
			{ runId: "run-7", level: "debug", message: "connecting" },
			{ runId: "run-7", level: "info", message: "found 3 playlists" },
			{ runId: "run-7", level: "warn", message: "skipping a local file" },
			{ runId: "run-7", level: "error", message: "server said 500" },
		]);
	});

	test("resolves credentials through the port", async () => {
		const { port } = recordingPort(async () => ({ accessToken: "a" }));
		expect(await createRunContext(outputPayload, port, withAuth).auth?.get()).toEqual({
			accessToken: "a",
		});
	});

	test("passes an AuthFailure from the port to the caller, still recognisable", async () => {
		const failure: AuthFailure = { service: "plex", code: "not-connected", message: "No grant" };
		const { port } = recordingPort(() => Promise.reject(failure));
		const rejection = await createRunContext(outputPayload, port, withAuth)
			.auth?.get()
			.then(
				() => undefined,
				(error: unknown) => error,
			);
		expect(isAuthFailure(rejection)).toBe(true);
		expect(rejection).toEqual(failure);
	});

	test("builds a context the boundary can carry: only the payload crosses (ADR-0010 §4)", () => {
		expect(structuredClone(outputPayload)).toEqual(outputPayload);
	});
});

describe("createTestContext", () => {
	test("has persistent settings, auth, log and configDir, and no instance", async () => {
		const { port, logs } = recordingPort(async () => ({ token: "t" }));
		const ctx = createTestContext(
			{ persistent: { prefix: "" }, configDir: "/config" },
			port,
			withAuth,
		);
		ctx.log.info("testing");
		expect(ctx).toMatchObject({ persistent: { prefix: "" }, configDir: "/config" });
		expect(ctx).not.toHaveProperty("instance");
		expect(await ctx.auth?.get()).toEqual({ token: "t" });
		expect(logs).toEqual([{ level: "info", message: "testing" }]);
	});

	test("gives a plugin that declares no auth no auth facade", () => {
		const { port } = recordingPort(async () => ({}));
		const ctx = createTestContext({ persistent: {}, configDir: "/config" }, port, withoutAuth);
		expect(ctx).not.toHaveProperty("auth");
	});
});
