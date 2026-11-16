import type { RunQueue } from "@ultrasonics/core";
import type { OpenDatabase, Applet as StoredApplet } from "@ultrasonics/db";
import { Component, issuesOf, type ValidationIssue } from "@ultrasonics/plugin-sdk";
import { Hono } from "hono";
import { z } from "zod";
import { type Applet, AppletDraft, type AppletListing } from "./api.ts";
import type { AppEnv } from "./app-env.ts";
import type { Catalogue } from "./catalogue.ts";
import { notFound } from "./error-response.ts";
import { jsonBody, pathParams } from "./validation.ts";

const IdParams = z.object({ id: z.string() });

/** The API's view of a row: the webhook hash becomes a flag, and no db-only column leaves. */
function appletOf(row: StoredApplet): Applet {
	return {
		id: row.id,
		name: row.name,
		enabled: row.enabled,
		definition: row.definition,
		schedule: row.schedule,
		hasWebhook: row.webhookTokenHash !== null,
	};
}

const COMPONENT_NAMES: Record<Component, string> = {
	inputs: "input",
	modifiers: "modifier",
	outputs: "output",
};

/**
 * Checks a draft against the catalogue, with issues at the paths the builder attaches them to:
 * `["name"]`, `[component, index]` and `[component, index, "settings", …]` (ADR-0019 §5).
 */
function checkDraft(catalogue: Catalogue, draft: AppletDraft): ValidationIssue[] {
	const issues: ValidationIssue[] =
		draft.name.trim() === "" ? [{ path: ["name"], message: "An applet needs a name" }] : [];
	for (const component of Component.options) {
		const slots = draft.definition[component];
		if (component !== "modifiers" && slots.length === 0) {
			issues.push({
				path: [component],
				message: `An applet needs at least one ${COMPONENT_NAMES[component]}`,
			});
		}
		for (const [index, slot] of slots.entries()) {
			const path = [component, index];
			const plugin = catalogue.plugins.get(slot.plugin);
			const schema = plugin?.run[component] ? plugin.instanceSettings[component] : undefined;
			if (!schema) {
				issues.push({ path, message: `${slot.plugin} is not a plugin for ${component}` });
				continue;
			}
			const parsed = schema.safeParse(slot.settings);
			if (!parsed.success) issues.push(...issuesOf(parsed.error, [...path, "settings"]));
		}
	}
	return issues;
}

export function appletRoutes(deps: { db: OpenDatabase; catalogue: Catalogue; queue: RunQueue }) {
	const { db, catalogue, queue } = deps;
	const storeOf = (accountId: string) => db.storeFor(accountId);

	return new Hono<AppEnv>()
		.get("/", async (c) => {
			const store = storeOf(c.var.session.accountId);
			const listings: AppletListing[] = [];
			for (const row of await store.applets.list()) {
				const [lastRun] = await store.runs.listForApplet(row.id);
				listings.push({
					...appletOf(row),
					state: queue.state(row.id),
					lastRun: lastRun
						? { id: lastRun.id, status: lastRun.status, at: lastRun.startedAt }
						: null,
					nextRunAt: row.nextRunAt,
				});
			}
			return c.json(listings);
		})
		.get("/:id", pathParams(IdParams), async (c) => {
			const row = await storeOf(c.var.session.accountId).applets.get(c.req.valid("param").id);
			return c.json(appletOf(row ?? notFound("The applet")));
		})
		.post("/", jsonBody(AppletDraft), async (c) => {
			const draft = c.req.valid("json");
			const issues = checkDraft(catalogue, draft);
			if (issues.length > 0) return c.json({ issues }, 422);
			const row = await storeOf(c.var.session.accountId).applets.create(draft);
			return c.json(appletOf(row), 201);
		})
		.put("/:id", pathParams(IdParams), jsonBody(AppletDraft), async (c) => {
			const store = storeOf(c.var.session.accountId);
			const { id } = c.req.valid("param");
			if (!(await store.applets.get(id))) notFound("The applet");
			const draft = c.req.valid("json");
			const issues = checkDraft(catalogue, draft);
			if (issues.length > 0) return c.json({ issues }, 422);
			const row = await store.applets.update(id, draft);
			return c.json(appletOf(row ?? notFound("The applet")));
		})
		.delete("/:id", pathParams(IdParams), async (c) => {
			// Its runs go with it, by cascade (ADR-0009 §5).
			const removed = await storeOf(c.var.session.accountId).applets.remove(
				c.req.valid("param").id,
			);
			if (!removed) notFound("The applet");
			return c.body(null, 204);
		});
}
