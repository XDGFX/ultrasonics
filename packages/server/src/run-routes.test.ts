import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	fromJournal,
	LOG_CAP_LINES,
	omittedLines,
	type RunEvent,
	toJournal,
} from "@ultrasonics/core";
import { AuthChallenge } from "@ultrasonics/plugin-sdk";
import { startFakeAccounts } from "../test/fake-spotify-accounts.ts";
import { heldSpotify, holds, registryOf, sink, spotify } from "../test/fixture-plugins.ts";
import {
	Applet,
	AppletListing,
	ConnectOutcome,
	ErrorBody,
	RunNowResult,
	RunSummary,
} from "./api.ts";
import { PkceFlow } from "./auth/pkce-flow.ts";
import { bodyOf, eventually, runStreamOf, type TestApp, useTestApp } from "./test-support.ts";

const testApp = useTestApp();

const heldDraft = (inputs: { plugin: string; settings: object }[], enabled = true) => ({
	name: "Held",
	enabled,
	definition: { inputs, modifiers: [], outputs: [{ plugin: "sink", settings: {} }] },
});
const held = (lines?: number) => ({ plugin: "held", settings: lines ? { lines } : {} });
const source = { plugin: "source", settings: { playlist: "Discover Weekly" } };

/** Creates the applet, first saving `source`'s persistent settings so its stage can run. */
async function createApplet(call: TestApp["call"], draft = heldDraft([held()])) {
	expect((await call("PUT", "/api/settings/source", { region: "au" })).status).toBe(200);
	return (await bodyOf(await call("POST", "/api/applets", draft), Applet)).id;
}

async function runNow(call: TestApp["call"], id: string) {
	const response = await call("POST", `/api/applets/${id}/run`);
	expect(response.status).toBe(202);
	return bodyOf(response, RunNowResult);
}

async function started(call: TestApp["call"], id: string): Promise<string> {
	const result = await runNow(call, id);
	if (result.kind !== "started") throw new Error(`run now answered ${result.kind}`);
	return result.runId;
}

const stateOf = async (call: TestApp["call"], id: string) =>
	(await bodyOf(await call("GET", "/api/applets"), AppletListing.array())).find(
		(applet) => applet.id === id,
	)?.state;

const seqs = (events: RunEvent[]) => events.map((event) => event.seq);
const heldStarted = (event: RunEvent) =>
	event.type === "stage" && event.plugin === "held" && event.state === "started";

describe("run now", () => {
	test("answers started with the run's id, then queued, absorbing further firings", async () => {
		const { call } = await testApp();
		const id = await createApplet(call);

		const runId = await started(call, id);
		expect(await bodyOf(await call("GET", `/api/runs/${runId}`), RunSummary)).toMatchObject({
			appletId: id,
			trigger: "manual",
			status: "running",
		});
		const first = await holds.next();
		expect(await stateOf(call, id)).toBe("running");

		expect(await runNow(call, id)).toEqual({ kind: "queued" });
		expect(await runNow(call, id)).toEqual({ kind: "queued" });
		expect(await stateOf(call, id)).toBe("queued");

		first.release();
		const second = await holds.next();
		expect(await stateOf(call, id)).toBe("running");
		second.release();

		await eventually(async () => expect(await stateOf(call, id)).toBe("idle"));
		const [listing] = await bodyOf(await call("GET", "/api/applets"), AppletListing.array());
		expect(listing?.lastRun?.status).toBe("succeeded");
		expect(await bodyOf(await call("GET", `/api/runs/${runId}`), RunSummary)).toMatchObject({
			status: "succeeded",
			finishedAt: expect.any(Number),
		});
	});

	test("starts a run on a disabled applet", async () => {
		const { call } = await testApp();
		const id = await createApplet(call, heldDraft([source], false));
		const runId = await started(call, id);
		await eventually(async () =>
			expect((await bodyOf(await call("GET", `/api/runs/${runId}`), RunSummary)).status).toBe(
				"succeeded",
			),
		);
	});

	test("gives each plugin a config directory under the run's account, made on first use", async () => {
		const { call, dataDir, mine } = await testApp();
		const id = await createApplet(call);
		await started(call, id);
		const run = await holds.next();
		expect(run.configDir).toBe(join(dataDir, "accounts", mine, "plugins", "held"));
		expect(existsSync(run.configDir)).toBe(true);
		run.release();
	});

	test("a queued run of an applet deleted meanwhile ends quietly", async () => {
		const { call, logger } = await testApp();
		const id = await createApplet(call);
		await started(call, id);
		const run = await holds.next();
		expect(await runNow(call, id)).toEqual({ kind: "queued" });
		expect((await call("DELETE", `/api/applets/${id}`)).status).toBe(204);

		run.release();
		await eventually(() =>
			expect(logger.lines).toContain(`info: Applet ${id} was deleted before its queued run`),
		);
		expect(logger.lines.filter((line) => line.startsWith("error"))).toEqual([]);
	});

	test("an unknown applet is a 404", async () => {
		const { call } = await testApp();
		const response = await call("POST", "/api/applets/nothing/run");
		expect(response.status).toBe(404);
		expect(await bodyOf(response, ErrorBody)).toEqual({ message: expect.any(String) });
	});
});

describe("the run stream", () => {
	test("streams a live run in seq order, resumes from Last-Event-ID, and replays it once finished", async () => {
		const { call, listen } = await testApp();
		const get = listen();
		const runId = await started(call, await createApplet(call));
		const run = await holds.next();

		const response = await get(`/api/runs/${runId}/events`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toStartWith("text/event-stream");
		expect(response.headers.get("x-accel-buffering")).toBe("no");
		const first = runStreamOf(response);
		const before = await first.until(heldStarted);
		first.close();

		const last = before.at(-1)?.seq ?? 0;
		const resumed = runStreamOf(
			await get(`/api/runs/${runId}/events`, { "Last-Event-ID": String(last) }),
		);
		run.release();
		const after = await resumed.rest();

		const live = [...before, ...after];
		expect(seqs(live)).toEqual(live.map((_, index) => index + 1));
		expect(live.at(-1)).toMatchObject({ type: "end", status: "succeeded" });

		const replayed = await runStreamOf(await get(`/api/runs/${runId}/events`)).rest();
		expect(replayed).toEqual(live);
		const tail = await runStreamOf(
			await get(`/api/runs/${runId}/events`, { "Last-Event-ID": String(last) }),
		).rest();
		expect(tail).toEqual(after);
	});

	test("two subscribers to one live run each get every event", async () => {
		const { call, listen } = await testApp();
		const get = listen();
		const runId = await started(call, await createApplet(call));
		const run = await holds.next();
		const one = runStreamOf(await get(`/api/runs/${runId}/events`));
		const two = runStreamOf(await get(`/api/runs/${runId}/events`));
		await one.until(heldStarted);
		await two.until(heldStarted);
		run.release();
		const [oneRest, twoRest] = await Promise.all([one.rest(), two.rest()]);
		expect(oneRest).toEqual(twoRest);
		expect(oneRest.at(-1)).toMatchObject({ type: "end" });
	});

	test("an interrupted run replays what was stored, then ends as interrupted", async () => {
		const { call, db, mine, raw, listen } = await testApp();
		const id = await createApplet(call);
		// What the last process wrote before it died: a checkpoint, then the next boot's interrupt.
		const store = db.storeFor(mine);
		const runId = await store.runs.start(id, "manual");
		if (!runId) throw new Error("the run's row was not created");
		const stored: RunEvent[] = [
			{ seq: 1, at: 1, type: "log", level: "info", source: "runner", text: "Applet" },
			{
				seq: 2,
				at: 2,
				type: "stage",
				component: "inputs",
				index: 0,
				plugin: "held",
				state: "started",
			},
		];
		await store.runs.checkpoint(runId, toJournal(stored));
		raw((sqlite) =>
			sqlite
				.query("UPDATE runs SET status = 'interrupted', finished_at = ? WHERE id = ?")
				.run(Date.now(), runId),
		);

		const get = listen();
		const events = await runStreamOf(await get(`/api/runs/${runId}/events`)).rest();
		expect(events).toEqual([
			...stored,
			{ seq: 3, at: expect.any(Number), type: "end", status: "interrupted" },
		]);

		// A browser that saw events after the last checkpoint still gets an end to stop on.
		const resumed = await runStreamOf(
			await get(`/api/runs/${runId}/events`, { "Last-Event-ID": "5" }),
		).rest();
		expect(resumed).toEqual([
			{ seq: 6, at: expect.any(Number), type: "end", status: "interrupted" },
		]);
	});
});

describe("the journal", () => {
	test("is on the row once a stage finishes, before the run ends", async () => {
		const { call, db, mine } = await testApp();
		const runId = await started(call, await createApplet(call, heldDraft([source, held()])));
		const run = await holds.next();
		await eventually(async () => {
			const row = await db.storeFor(mine).runs.get(runId);
			expect(row?.status).toBe("running");
			expect(fromJournal(row)).toContainEqual(
				expect.objectContaining({ type: "stage", plugin: "source", state: "finished" }),
			);
		});
		run.release();
	});

	test("skips a stage finish within the checkpoint interval of the last write", async () => {
		const { call, db, mine } = await testApp();
		const runId = await started(
			call,
			await createApplet(call, heldDraft([source, source, held()])),
		);
		const run = await holds.next();
		await eventually(async () =>
			expect(fromJournal(await db.storeFor(mine).runs.get(runId)).length).toBeGreaterThan(0),
		);
		const stages = fromJournal(await db.storeFor(mine).runs.get(runId)).filter(
			(event) => event.type === "stage",
		);
		expect(stages).toEqual([
			expect.objectContaining({ index: 0, state: "started" }),
			expect.objectContaining({ index: 0, state: "finished" }),
		]);
		run.release();
	});

	test("is written in full at the end, with the log cap applied", async () => {
		const { call, db, mine } = await testApp();
		const runId = await started(call, await createApplet(call, heldDraft([held(LOG_CAP_LINES)])));
		(await holds.next()).release();
		await eventually(async () =>
			expect((await db.storeFor(mine).runs.get(runId))?.status).toBe("succeeded"),
		);
		const events = fromJournal(await db.storeFor(mine).runs.get(runId));
		const log = events.filter((event) => event.type === "log");
		const keptOfHeld = log.filter((event) => event.source === "held").length;
		expect(log.length).toBeLessThanOrEqual(LOG_CAP_LINES);
		expect(log).toContainEqual(
			expect.objectContaining({ source: "runner", text: omittedLines(LOG_CAP_LINES - keptOfHeld) }),
		);
		expect(events.at(-1)).toMatchObject({ type: "end", status: "succeeded" });
	});
});

describe("service auth in a run", () => {
	test("two runs on one account share one in-flight refresh of an expired token", async () => {
		const accounts = startFakeAccounts();
		try {
			const clock = { now: Date.UTC(2026, 10, 16) };
			const pkce = new PkceFlow({ endpoints: accounts.endpoints, now: () => clock.now });
			const { call } = await testApp({ pkce, registry: registryOf(spotify, heldSpotify, sink) });
			await call("PUT", "/api/services/spotify/client", {
				clientId: "0123456789abcdef0123456789abcdef",
			});
			const { authoriseUrl } = await bodyOf(
				await call("POST", "/api/services/spotify/begin", {}),
				AuthChallenge,
			);
			const returned = await accounts.consent(authoriseUrl);
			expect(
				await bodyOf(
					await call("POST", "/api/services/spotify/complete", returned),
					ConnectOutcome,
				),
			).toEqual({ kind: "connected" });

			clock.now += 3600 * 1000;
			const before = accounts.tokenRequests.length;
			const draft = heldDraft([{ plugin: "held-spotify", settings: {} }]);
			const one = await bodyOf(await call("POST", "/api/applets", draft), Applet);
			const two = await bodyOf(await call("POST", "/api/applets", draft), Applet);
			await started(call, one.id);
			await started(call, two.id);
			const runs = [await holds.next(), await holds.next()];

			expect(accounts.tokenRequests.length - before).toBe(1);
			expect(accounts.tokenRequests.at(-1)?.get("grant_type")).toBe("refresh_token");
			expect(runs.map((run) => run.accessToken)).toEqual([accounts.issued[2], accounts.issued[2]]);
			for (const run of runs) run.release();
		} finally {
			await accounts.stop();
		}
	});
});
