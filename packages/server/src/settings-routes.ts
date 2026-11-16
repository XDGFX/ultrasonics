import type { OpenDatabase } from "@ultrasonics/db";
import { issuesOf } from "@ultrasonics/plugin-sdk";
import { Hono } from "hono";
import { z } from "zod";
import { type CheckResult, JsonBody, type StoredSettings } from "./api.ts";
import type { AppEnv } from "./app-env.ts";
import { type Catalogue, isCheckable } from "./catalogue.ts";
import { notFound } from "./error-response.ts";
import { type PluginTestDeps, runPluginTest, storedPersistent } from "./plugin-test.ts";
import { jsonBody, pathParams } from "./validation.ts";

const PluginParams = z.object({ plugin: z.string() });

export interface SettingsRouteDeps extends PluginTestDeps {
	db: OpenDatabase;
	catalogue: Catalogue;
}

/**
 * A plugin's account-wide persistent settings; the server is the only validator (ADR-0019 §5). A
 * checkable plugin's `test()` runs here against them.
 */
export function settingsRoutes(deps: SettingsRouteDeps) {
	const { db, catalogue } = deps;
	const pluginOf = (name: string) => catalogue.plugins.get(name) ?? notFound(`The plugin ${name}`);

	return new Hono<AppEnv>()
		.get("/:plugin", pathParams(PluginParams), async (c) => {
			const { plugin: name } = c.req.valid("param");
			const schema = pluginOf(name).persistentSettings;
			const value = (await db.storeFor(c.var.session.accountId).pluginSettings.get(name)) ?? {};
			// The value comes back raw, with what it fails today (ADR-0019 §7).
			const parsed = schema?.safeParse(value);
			const body: StoredSettings = {
				value,
				issues: parsed?.success === false ? issuesOf(parsed.error) : [],
			};
			return c.json(body);
		})
		.put("/:plugin", pathParams(PluginParams), jsonBody(JsonBody), async (c) => {
			const { plugin: name } = c.req.valid("param");
			const schema = pluginOf(name).persistentSettings;
			if (!schema) {
				return c.json({ issues: [{ path: [], message: `${name} has no settings` }] }, 422);
			}
			const value = c.req.valid("json");
			const parsed = schema.safeParse(value);
			if (!parsed.success) return c.json({ issues: issuesOf(parsed.error) }, 422);
			// Stored raw, so a later schema reads what the user typed (ADR-0019 §7).
			await db.storeFor(c.var.session.accountId).pluginSettings.put(name, value);
			// Widened: Hono's JSON typing recurses without end on `JsonValue`.
			return c.json(value as object);
		})
		.post("/:plugin/check", pathParams(PluginParams), async (c) => {
			const { accountId } = c.var.session;
			const plugin = pluginOf(c.req.valid("param").plugin);
			if (!isCheckable(plugin)) {
				const message = plugin.auth
					? `${plugin.name} is checked when you connect ${plugin.auth.service}`
					: `${plugin.name} has no check`;
				return c.json({ issues: [{ path: [], message }] }, 422);
			}
			const persistent = await storedPersistent(db, accountId, plugin);
			if (!persistent.success) return c.json({ issues: issuesOf(persistent.error) }, 422);
			const result: CheckResult = await runPluginTest(deps, accountId, plugin, persistent.data);
			return c.json(result);
		});
}
