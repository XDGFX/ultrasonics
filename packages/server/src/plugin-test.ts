import type { OpenDatabase } from "@ultrasonics/db";
import { createTestContext, type Plugin, TestResult } from "@ultrasonics/plugin-sdk";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import type { Logger } from "./logger.ts";
import { pluginConfigDir } from "./plugin-config-dir.ts";

export type TestablePlugin = Plugin & Required<Pick<Plugin, "test">>;

/** The account's stored persistent settings for `plugin`, parsed with its schema; `{}` when it has none. */
export async function storedPersistent(
	db: OpenDatabase,
	accountId: string,
	plugin: Plugin,
): Promise<z.ZodSafeParseResult<Record<string, unknown>>> {
	const raw = await db.storeFor(accountId).pluginSettings.get(plugin.name);
	const parsed = plugin.persistentSettings?.safeParse(raw ?? {});
	// A settings schema's top level is an object or a union of objects (ADR-0019 §3).
	return (parsed ?? { success: true, data: {} }) as z.ZodSafeParseResult<Record<string, unknown>>;
}

export interface PluginTestDeps {
	dataDir: string;
	logger: Logger;
}

/**
 * Calls `plugin.test()` through the SDK's harness. `credentials` is given only to a plugin that
 * declares auth. A throw, or an answer that isn't a `TestResult`, means the plugin itself is broken
 * (ADR-0012 §5): a `500` naming it.
 */
export async function runPluginTest(
	deps: PluginTestDeps,
	accountId: string,
	plugin: TestablePlugin,
	persistent: Record<string, unknown>,
	credentials?: () => Promise<unknown>,
): Promise<TestResult> {
	const { dataDir, logger } = deps;
	const context = createTestContext(
		{ persistent, configDir: pluginConfigDir(dataDir, accountId, plugin.name) },
		{
			credentials: credentials ?? (async () => ({})),
			log: (entry) =>
				logger[entry.level === "debug" ? "info" : entry.level](
					`${plugin.name} test: ${entry.message}`,
				),
		},
		{ declaresAuth: credentials !== undefined },
	);
	let result: unknown;
	try {
		result = await plugin.test(context);
	} catch (error) {
		logger.error(`${plugin.name}'s test() threw`, error);
		throw new HTTPException(500, {
			message: `The ${plugin.name} plugin is broken: its test threw`,
		});
	}
	const parsed = TestResult.safeParse(result);
	if (!parsed.success) {
		throw new HTTPException(500, {
			message: `The ${plugin.name} plugin is broken: its test returned no result`,
		});
	}
	return parsed.data;
}
