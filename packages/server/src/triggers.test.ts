import { describe, expect, test } from "bun:test";
import { holds } from "../test/fixture-plugins.ts";
import { Applet, AppletListing, ErrorBody, IssuesBody, WebhookFired, WebhookUrl } from "./api.ts";
import { UNEXPECTED_ERROR_MESSAGE } from "./error-response.ts";
import {
	bodyOf,
	CLIENT_ADDRESS_HEADER,
	eventually,
	type TestApp,
	useTestApp,
} from "./test-support.ts";
import { WEBHOOK_PATH } from "./webhook-route.ts";

const testApp = useTestApp();

const definition = {
	inputs: [{ plugin: "source", settings: { playlist: "Discover Weekly" } }],
	modifiers: [],
	outputs: [{ plugin: "sink", settings: {} }],
};
const draft = (enabled = true) => ({ name: "Daily sync", enabled, definition });

/** Daily at 03:00 UTC from 1 January 2026. */
const daily = {
	kind: "interval",
	unit: "day",
	count: 1,
	anchor: "2026-01-01T03:00",
	timeZone: "UTC",
} as const;

const at = (iso: string) => Date.parse(iso);

async function createApplet(call: TestApp["call"], enabled = true): Promise<string> {
	expect((await call("PUT", "/api/settings/source", { region: "au" })).status).toBe(200);
	return (await bodyOf(await call("POST", "/api/applets", draft(enabled)), Applet)).id;
}

const listingOf = async (call: TestApp["call"], id: string) =>
	(await bodyOf(await call("GET", "/api/applets"), AppletListing.array())).find(
		(applet) => applet.id === id,
	);

describe("the schedule route", () => {
	test("setting a schedule stores it with the next future slot, and clearing it removes both", async () => {
		const { call, clock } = await testApp();
		clock.now = at("2026-02-10T12:00Z");
		const id = await createApplet(call);

		const response = await call("PUT", `/api/applets/${id}/schedule`, daily);
		expect(response.status).toBe(200);
		expect((await bodyOf(response, Applet)).schedule).toEqual(daily);
		expect(await listingOf(call, id)).toMatchObject({
			schedule: daily,
			nextRunAt: at("2026-02-11T03:00Z"),
		});

		const cleared = await call("PUT", `/api/applets/${id}/schedule`, null);
		expect((await bodyOf(cleared, Applet)).schedule).toBeNull();
		expect(await listingOf(call, id)).toMatchObject({ schedule: null, nextRunAt: null });
	});

	test("a bad schedule is refused with issues at its fields", async () => {
		const { call } = await testApp();
		const id = await createApplet(call);
		const response = await call("PUT", `/api/applets/${id}/schedule`, {
			...daily,
			count: 0,
			anchor: "2026-01-01T03:00Z",
			timeZone: "Mars/Olympus_Mons",
		});
		expect(response.status).toBe(422);
		const { issues } = await bodyOf(response, IssuesBody);
		const fields = new Set(issues.map((issue) => issue.path.join(".")));
		expect([...fields].sort()).toEqual(["anchor", "count", "timeZone"]);
		expect((await listingOf(call, id))?.schedule).toBeNull();
	});

	test("turning enabled on moves the next run to the next future slot; turning it off leaves it", async () => {
		const { call, clock } = await testApp();
		clock.now = at("2026-02-10T12:00Z");
		const id = await createApplet(call);
		await call("PUT", `/api/applets/${id}/schedule`, daily);

		clock.now = at("2026-02-14T12:00Z");
		await call("PUT", `/api/applets/${id}`, draft(false));
		expect((await listingOf(call, id))?.nextRunAt).toBe(at("2026-02-11T03:00Z"));

		clock.now = at("2026-02-20T12:00Z");
		await call("PUT", `/api/applets/${id}`, draft(true));
		expect((await listingOf(call, id))?.nextRunAt).toBe(at("2026-02-21T03:00Z"));

		// Saving an applet that was already enabled leaves its slot alone.
		clock.now = at("2026-02-23T12:00Z");
		await call("PUT", `/api/applets/${id}`, draft(true));
		expect((await listingOf(call, id))?.nextRunAt).toBe(at("2026-02-21T03:00Z"));
	});

	test("an unknown applet, or another account's, is a 404", async () => {
		const { call, db, theirs } = await testApp();
		const { id } = await db.storeFor(theirs).applets.create(draft());
		expect((await call("PUT", `/api/applets/${id}/schedule`, daily)).status).toBe(404);
		expect((await call("PUT", "/api/applets/nope/schedule", daily)).status).toBe(404);
		expect((await db.storeFor(theirs).applets.get(id))?.schedule).toBeNull();
	});
});

describe("the scheduler", () => {
	/** An applet on the daily schedule, set on 10 February so its first slot is 11 February 03:00. */
	async function scheduledApplet(t: TestApp, enabled = true): Promise<string> {
		t.clock.now = at("2026-02-10T12:00Z");
		const id = await createApplet(t.call, enabled);
		expect((await t.call("PUT", `/api/applets/${id}/schedule`, daily)).status).toBe(200);
		return id;
	}

	/** Every run of the applet, newest first, once the queue has let them all finish. */
	async function settledRuns(t: TestApp, id: string) {
		await eventually(async () => expect((await listingOf(t.call, id))?.state).toBe("idle"));
		return t.db.storeFor(t.mine).runs.listForApplet(id);
	}

	test("a due applet runs once, triggered by the schedule, and its next run moves on", async () => {
		const t = await testApp();
		const id = await scheduledApplet(t);

		t.clock.now = at("2026-02-11T03:00:20Z");
		await t.scheduler.tick();
		expect((await listingOf(t.call, id))?.nextRunAt).toBe(at("2026-02-12T03:00Z"));
		await t.scheduler.tick();

		const runs = await settledRuns(t, id);
		expect(runs.map((run) => [run.trigger, run.status])).toEqual([["schedule", "succeeded"]]);
	});

	test("an applet not yet due does not run", async () => {
		const t = await testApp();
		const id = await scheduledApplet(t);
		t.clock.now = at("2026-02-11T02:59:59Z");
		await t.scheduler.tick();
		expect(await settledRuns(t, id)).toEqual([]);
	});

	test("several missed slots collapse into one run, then the schedule returns to its grid", async () => {
		const t = await testApp();
		const id = await scheduledApplet(t);

		t.clock.now = at("2026-02-15T12:00Z");
		await t.scheduler.tick();
		await t.scheduler.tick();
		expect(await settledRuns(t, id)).toHaveLength(1);
		expect((await listingOf(t.call, id))?.nextRunAt).toBe(at("2026-02-16T03:00Z"));
	});

	test("a disabled applet does not run on its schedule, and re-enabling it fires nothing", async () => {
		const t = await testApp();
		const id = await scheduledApplet(t, false);

		t.clock.now = at("2026-02-15T12:00Z");
		await t.scheduler.tick();
		expect(await settledRuns(t, id)).toEqual([]);

		await t.call("PUT", `/api/applets/${id}`, draft(true));
		await t.scheduler.tick();
		expect(await settledRuns(t, id)).toEqual([]);
		expect((await listingOf(t.call, id))?.nextRunAt).toBe(at("2026-02-16T03:00Z"));
	});

	test("an applet whose run fails to start is logged, and the others still run", async () => {
		const t = await testApp();
		const broken = await scheduledApplet(t);
		const id = await scheduledApplet(t);
		// A definition that no longer parses, as a bad migration might leave one.
		t.raw((sqlite) =>
			sqlite.query("UPDATE applets SET definition = '{}' WHERE id = ?").run(broken),
		);

		t.clock.now = at("2026-02-11T03:00:20Z");
		await t.scheduler.tick();
		// The listing can't parse the broken row either, so read the runs through the store.
		await eventually(async () => {
			const runs = await t.db.storeFor(t.mine).runs.listForApplet(id);
			expect(runs.map((run) => run.status)).toEqual(["succeeded"]);
		});
		expect(t.logger.lines.some((line) => line.startsWith("error:") && line.includes(broken))).toBe(
			true,
		);
	});

	test("each tick sweeps expired sessions", async () => {
		const t = await testApp();
		t.clock.now = at("2026-02-11T00:00Z");
		const insert = (id: string, expiresAt: number) =>
			t.raw((sqlite) =>
				sqlite
					.query(
						"INSERT INTO sessions (id, account_id, token_hash, created_at, authenticated_at, last_seen_at, expires_at) VALUES (?, ?, ?, 0, 0, 0, ?)",
					)
					.run(id, t.mine, `hash-${id}`, expiresAt),
			);
		insert("expired", t.clock.now - 1);
		insert("live", t.clock.now + 60_000);

		await t.scheduler.tick();
		const left = t.raw((sqlite) => sqlite.query("SELECT id FROM sessions ORDER BY id").all());
		expect(left).toEqual([{ id: "live" }]);
	});
});

describe("the webhook", () => {
	/** Generates the applet's webhook from `headers`' point of view, and returns its URL. */
	async function generate(t: TestApp, id: string, headers: Record<string, string> = {}) {
		const response = await t.call("POST", `/api/applets/${id}/webhook`, undefined, headers);
		expect(response.status).toBe(200);
		return new URL((await bodyOf(response, WebhookUrl)).url);
	}

	/** A request as an automation sends it: whatever method, headers and body it likes. */
	const hook = (t: TestApp, path: string, init: RequestInit = {}) =>
		t.app.request(path, {
			...init,
			headers: { [CLIENT_ADDRESS_HEADER]: "192.168.1.30", ...init.headers },
		});

	async function fired(response: Response) {
		expect(response.status).toBe(202);
		return (await bodyOf(response, WebhookFired)).status;
	}

	test("GET, POST and a bearer token each start a run, triggered by the webhook", async () => {
		const t = await testApp();
		const id = await createApplet(t.call);
		const url = await generate(t, id);
		expect(url.pathname).toMatch(/^\/api\/hooks\/[A-Za-z0-9_-]{43}$/);
		expect((await listingOf(t.call, id))?.hasWebhook).toBe(true);
		const token = url.pathname.split("/").at(-1) ?? "";

		const forms: RequestInit[] = [
			{ method: "GET" },
			{ method: "POST" },
			{ method: "POST", headers: { Authorization: `Bearer ${token}` } },
		];
		for (const [index, init] of forms.entries()) {
			const path = init.headers ? "/api/hooks" : url.pathname;
			expect(await fired(await hook(t, path, init))).toBe("started");
			await eventually(async () =>
				expect(await t.db.storeFor(t.mine).runs.listForApplet(id)).toHaveLength(index + 1),
			);
			await eventually(async () => expect((await listingOf(t.call, id))?.state).toBe("idle"));
		}
		const runs = await t.db.storeFor(t.mine).runs.listForApplet(id);
		expect(runs.map((run) => run.trigger)).toEqual(["webhook", "webhook", "webhook"]);
	});

	test("any content type is accepted and the body ignored, with no session", async () => {
		const t = await testApp({ authSource: "proxy", trustedProxies: ["10.0.0.0/8"] });
		const id = await bodyOf(
			await t.call("POST", "/api/applets", draft(), {
				[CLIENT_ADDRESS_HEADER]: "10.0.0.2",
				"Remote-User": "cal",
			}),
			Applet,
		).then((applet) => applet.id);
		const url = await generate(t, id, {
			[CLIENT_ADDRESS_HEADER]: "10.0.0.2",
			"Remote-User": "cal",
		});

		// Plex sends multipart; others send text, or JSON that isn't ours.
		const plex = new FormData();
		plex.append("payload", JSON.stringify({ event: "library.new" }));
		const bodies: RequestInit[] = [
			{ method: "POST", body: plex },
			{ method: "POST", body: "not json", headers: { "Content-Type": "text/plain" } },
			{ method: "POST", body: "{", headers: { "Content-Type": "application/json" } },
		];
		for (const init of bodies) {
			expect(["started", "queued"]).toContain(await fired(await hook(t, url.pathname, init)));
		}
	});

	test("a firing while the applet runs queues one more run, and further firings are absorbed", async () => {
		const t = await testApp();
		expect((await t.call("PUT", "/api/settings/source", { region: "au" })).status).toBe(200);
		const { id } = await bodyOf(
			await t.call("POST", "/api/applets", {
				name: "Held",
				enabled: true,
				definition: {
					inputs: [{ plugin: "held", settings: {} }],
					modifiers: [],
					outputs: [{ plugin: "sink", settings: {} }],
				},
			}),
			Applet,
		);
		const { pathname } = await generate(t, id);

		expect(await fired(await hook(t, pathname, { method: "POST" }))).toBe("started");
		const first = await holds.next();
		expect(await fired(await hook(t, pathname, { method: "POST" }))).toBe("queued");
		expect(await fired(await hook(t, pathname, { method: "POST" }))).toBe("queued");
		expect((await listingOf(t.call, id))?.state).toBe("queued");

		first.release();
		(await holds.next()).release();
		await eventually(async () => expect((await listingOf(t.call, id))?.state).toBe("idle"));
		expect(await t.db.storeFor(t.mine).runs.listForApplet(id)).toHaveLength(2);
	});

	test("an unknown token and a revoked one get identical 404s", async () => {
		const t = await testApp();
		const id = await createApplet(t.call);
		const old = await generate(t, id);
		const current = await generate(t, id);

		const unknown = await hook(t, `/api/hooks/${"A".repeat(43)}`, { method: "POST" });
		const revoked = await hook(t, old.pathname, { method: "POST" });
		const missingBearer = await hook(t, "/api/hooks", { method: "POST" });
		// Never handed on to `/api`, whose proxy session logs the path, which is the token.
		const otherMethod = await hook(t, current.pathname, { method: "PUT" });
		const longerPath = await hook(t, `${current.pathname}/more`, { method: "GET" });
		const misses = [unknown, revoked, missingBearer, otherMethod, longerPath];
		expect(misses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
		const bodies = await Promise.all(misses.map((response) => response.text()));
		const notFoundBody = await bodyOf(new Response(bodies[0]), ErrorBody);
		expect(bodies.map((body) => JSON.parse(body))).toEqual(Array(bodies.length).fill(notFoundBody));

		expect(await fired(await hook(t, current.pathname, { method: "POST" }))).toBe("started");

		expect((await t.call("DELETE", `/api/applets/${id}/webhook`)).status).toBe(204);
		expect((await listingOf(t.call, id))?.hasWebhook).toBe(false);
		const removed = await hook(t, current.pathname, { method: "POST" });
		expect(removed.status).toBe(404);
		expect(await removed.json()).toEqual(notFoundBody);
	});

	test("a database failure answers a generic 500 and keeps the token out of the log", async () => {
		const t = await testApp();
		const id = await createApplet(t.call);
		const { pathname } = await generate(t, id);
		const token = pathname.split("/").at(-1) ?? "";
		expect(token).not.toBe("");
		t.raw((sqlite) =>
			sqlite.run(
				"CREATE TRIGGER refuse_runs BEFORE INSERT ON runs BEGIN SELECT RAISE(FAIL, 'disk full'); END",
			),
		);

		for (const method of ["GET", "POST"]) {
			const response = await hook(t, pathname, { method });
			expect(response.status).toBe(500);
			expect((await bodyOf(response, ErrorBody)).message).toBe(UNEXPECTED_ERROR_MESSAGE);
		}
		expect(t.logger.lines.filter((line) => line.includes(WEBHOOK_PATH))).toHaveLength(2);
		expect(t.logger.lines.filter((line) => line.includes(token))).toEqual([]);
	});

	test("a disabled applet answers 409 and queues nothing", async () => {
		const t = await testApp();
		const id = await createApplet(t.call, false);
		const { pathname } = await generate(t, id);
		const response = await hook(t, pathname, { method: "POST" });
		expect(response.status).toBe(409);
		await bodyOf(response, ErrorBody);
		expect(await t.db.storeFor(t.mine).runs.listForApplet(id)).toEqual([]);
	});

	test("the URL's origin follows Host, and X-Forwarded-* only from a trusted proxy", async () => {
		const t = await testApp({ trustedProxies: ["10.0.0.0/8"] });
		const id = await createApplet(t.call);
		const forwarded = {
			Host: "192.168.1.5:5050",
			"X-Forwarded-Proto": "https",
			"X-Forwarded-Host": "music.example.org",
		};
		expect((await generate(t, id, { Host: "192.168.1.5:5050" })).origin).toBe(
			"http://192.168.1.5:5050",
		);
		expect((await generate(t, id, forwarded)).origin).toBe("http://192.168.1.5:5050");
		expect(
			(await generate(t, id, { ...forwarded, [CLIENT_ADDRESS_HEADER]: "10.0.0.2" })).origin,
		).toBe("https://music.example.org");
	});

	test("another account's applet, or an unknown one, is a 404", async () => {
		const t = await testApp();
		const { id } = await t.db.storeFor(t.theirs).applets.create(draft());
		for (const path of [`/api/applets/${id}/webhook`, "/api/applets/nope/webhook"]) {
			expect((await t.call("POST", path)).status).toBe(404);
			expect((await t.call("DELETE", path)).status).toBe(404);
		}
		expect((await t.db.storeFor(t.theirs).applets.get(id))?.webhookTokenHash).toBeNull();
	});
});
