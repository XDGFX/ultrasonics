import { fromJournal, type RunEvent } from "@ultrasonics/core";
import type { OpenDatabase, Run } from "@ultrasonics/db";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { RunSummary } from "./api.ts";
import type { AppEnv } from "./app-env.ts";
import { notFound } from "./error-response.ts";
import type { RunHub } from "./run-hub.ts";
import { pathParams } from "./validation.ts";

/** How often a run stream sends a comment line, so a quiet run's connection stays open. */
export const HEARTBEAT_MS = 15_000;

/**
 * The server's idle timeout, in Bun's seconds. Bun's default of 10 would close a quiet stream before
 * its first heartbeat, so the server sets twice the heartbeat instead.
 */
export const IDLE_TIMEOUT_SECONDS = (2 * HEARTBEAT_MS) / 1000;

const IdParams = z.object({ id: z.string() });

/** The last `seq` the browser saw, which it sends back on reconnecting (ADR-0026 §3). */
const LastEventId = z.coerce.number().int().min(0).catch(0);

/**
 * A stored run's events after `after`, ending in `end` like a live run's. A run cut short never
 * wrote its end, so one is added with the row's status, `interrupted` (ADR-0026 §4). Its `seq` is
 * one past the last stored, or past `after` when the browser saw events the last checkpoint missed,
 * so the browser still gets an end to stop on.
 */
function storedEvents(row: Run, after: number): RunEvent[] {
	const events = fromJournal(row).filter((event) => event.seq > after);
	const last = events.at(-1);
	if (last?.type === "end") return events;
	// A `running` row outside the hub belongs to a process that's gone.
	const status = row.status === "running" ? "interrupted" : row.status;
	const end: RunEvent = {
		type: "end",
		status,
		seq: Math.max(last?.seq ?? 0, after) + 1,
		at: row.finishedAt ?? Date.now(),
	};
	return [...events, end];
}

export function runRoutes(deps: { db: OpenDatabase; hub: RunHub }) {
	const { db, hub } = deps;

	return new Hono<AppEnv>()
		.get("/:id", pathParams(IdParams), async (c) => {
			const run = await db.storeFor(c.var.session.accountId).runs.get(c.req.valid("param").id);
			if (!run) notFound("The run");
			const summary: RunSummary = {
				id: run.id,
				appletId: run.appletId,
				trigger: run.trigger,
				status: run.status,
				startedAt: run.startedAt,
				finishedAt: run.finishedAt,
			};
			return c.json(summary);
		})
		.get("/:id/events", pathParams(IdParams), async (c) => {
			const store = db.storeFor(c.var.session.accountId);
			const { id } = c.req.valid("param");
			if (!(await store.runs.get(id))) notFound("The run");
			const after = LastEventId.parse(c.req.header("Last-Event-ID"));
			c.header("X-Accel-Buffering", "no");

			return streamSSE(c, async (stream) => {
				const send = (event: RunEvent) =>
					stream.writeSSE({ id: String(event.seq), data: JSON.stringify(event) });
				const beat = () => stream.write(": heartbeat\n\n");
				// Bun sends the headers with the first write; a resumed quiet run has nothing else yet.
				await beat();
				const heartbeat = setInterval(() => void beat(), HEARTBEAT_MS);
				try {
					const pending: RunEvent[] = [];
					let wake: (() => void) | undefined;
					const unfollow = hub.follow(id, after, (event) => {
						pending.push(event);
						wake?.();
					});
					if (!unfollow) {
						// Finished while we looked it up, or long ago: the row has it all.
						const row = await store.runs.get(id);
						for (const event of row ? storedEvents(row, after) : []) await send(event);
						return;
					}
					stream.onAbort(() => wake?.());
					try {
						while (!stream.aborted) {
							const event = pending.shift();
							if (!event) {
								await new Promise<void>((resolve) => {
									wake = resolve;
								});
								continue;
							}
							await send(event);
							if (event.type === "end") return;
						}
					} finally {
						unfollow();
					}
				} finally {
					clearInterval(heartbeat);
				}
			});
		});
}
