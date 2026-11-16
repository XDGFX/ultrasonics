import { type OpenDatabase, Schedule } from "@ultrasonics/db";
import { Hono } from "hono";
import { z } from "zod";
import type { WebhookUrl } from "./api.ts";
import type { AppEnv } from "./app-env.ts";
import { appletOf } from "./applet-routes.ts";
import { notFound } from "./error-response.ts";
import { nextSlot } from "./next-slot.ts";
import { requestOrigin } from "./request-source.ts";
import { jsonBody, pathParams } from "./validation.ts";
import { newWebhookToken, webhookTokenHash } from "./webhook-token.ts";

const IdParams = z.object({ id: z.string() });

/** An applet's triggers, mounted under `/applets` beside its other routes (ADR-0018). */
export function triggerRoutes(deps: { db: OpenDatabase; now: () => number }) {
	const { db, now } = deps;

	return new Hono<AppEnv>()
		.put("/:id/schedule", pathParams(IdParams), jsonBody(Schedule.nullable()), async (c) => {
			const store = db.storeFor(c.var.session.accountId);
			const { id } = c.req.valid("param");
			const schedule = c.req.valid("json");
			// Setting or editing jumps to the next future slot: nothing fires a catch-up (ADR-0018 §4).
			const written = await store.applets.setSchedule(
				id,
				schedule && { schedule, nextRunAt: nextSlot(schedule, now()) },
			);
			if (!written) notFound("The applet");
			return c.json(appletOf((await store.applets.get(id)) ?? notFound("The applet")));
		})
		.post("/:id/webhook", pathParams(IdParams), async (c) => {
			// The hash replaces any earlier one, so the old token stops working at once.
			const token = newWebhookToken();
			const written = await db
				.storeFor(c.var.session.accountId)
				.applets.setWebhookTokenHash(c.req.valid("param").id, webhookTokenHash(token));
			if (!written) notFound("The applet");
			// Shown this once: only the hash is kept.
			return c.json({ url: `${requestOrigin(c)}/api/hooks/${token}` } satisfies WebhookUrl);
		})
		.delete("/:id/webhook", pathParams(IdParams), async (c) => {
			const removed = await db
				.storeFor(c.var.session.accountId)
				.applets.setWebhookTokenHash(c.req.valid("param").id, null);
			if (!removed) notFound("The applet");
			return c.body(null, 204);
		});
}
