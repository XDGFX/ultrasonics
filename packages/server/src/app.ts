import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/bun";
import type { RunQueue } from "@ultrasonics/core";
import type { OpenDatabase } from "@ultrasonics/db";
import type { PluginRegistry } from "@ultrasonics/plugin-sdk";
import { Hono } from "hono";
import type { InstanceInfo } from "./api.ts";
import type { AppEnv, ClientAddress } from "./app-env.ts";
import { appletRoutes } from "./applet-routes.ts";
import { PkceFlow } from "./auth/pkce-flow.ts";
import type { Catalogue } from "./catalogue.ts";
import type { Configuration } from "./configuration.ts";
import { requireJson } from "./cross-site.ts";
import { errorResponse, notFound } from "./error-response.ts";
import type { Logger } from "./logger.ts";
import { requestSourceMiddleware } from "./request-source.ts";
import { createRunHub } from "./run-hub.ts";
import { runRoutes } from "./run-routes.ts";
import { createRunStarter } from "./run-starter.ts";
import { createScheduler } from "./scheduler.ts";
import { serviceRoutes } from "./service-routes.ts";
import { sessionMiddleware } from "./session-middleware.ts";
import { settingsRoutes } from "./settings-routes.ts";
import { triggerRoutes } from "./trigger-routes.ts";
import { WEBHOOK_PATH, webhookRoute } from "./webhook-route.ts";

/** Where `packages/web` builds the UI, relative to this file in the repo and in the image. */
export const DEFAULT_WEB_ROOT = fileURLToPath(new URL("../../web/dist", import.meta.url));

export interface AppDeps {
	configuration: Pick<
		Configuration,
		"authSource" | "trustedProxies" | "proxyUserHeader" | "dataDir"
	>;
	db: OpenDatabase;
	/** The registry the catalogue was loaded from; the runner loads plugins through it. */
	registry: PluginRegistry;
	catalogue: Catalogue;
	/** The one run queue for the whole server: run now, the scheduler and the webhook (#110). */
	queue: RunQueue;
	clientAddress: ClientAddress;
	logger: Logger;
	/** The built UI; absent or missing on disk, only the API is served. */
	webRoot?: string;
	/** The server's one PKCE flow; the real services' when absent, a fake's in tests. */
	pkce?: PkceFlow;
	/**
	 * Epoch milliseconds, for the schedule, the scheduler and the run hub's checkpoints and end
	 * events; `Date.now` when absent.
	 */
	now?: () => number;
}

/**
 * The whole HTTP surface as one Hono app, built from its dependencies so tests drive it in-process
 * with `app.request()` (ADR-0024), the scheduler, unstarted, that fires runs beside it, and the run
 * starter they share, which shutdown drains.
 */
export async function createApp(deps: AppDeps) {
	const { configuration, db, registry, catalogue, queue, logger } = deps;
	const pkce = deps.pkce ?? new PkceFlow();
	const now = deps.now ?? Date.now;
	const hub = createRunHub({ logger, now });
	const runs = createRunStarter({
		db,
		registry,
		catalogue,
		queue,
		hub,
		pkce,
		dataDir: configuration.dataDir,
		logger,
	});
	const session = await sessionMiddleware({
		db,
		authSource: configuration.authSource,
		proxyUserHeader: configuration.proxyUserHeader,
		logger,
	});

	const api = new Hono<AppEnv>()
		.use(requireJson)
		.use(session)
		.get("/instance", (c) => c.json({ exposed: c.var.exposed } satisfies InstanceInfo))
		.get("/plugins", (c) => c.json(catalogue.info))
		.route("/applets", appletRoutes({ db, catalogue, queue, runs, now }))
		.route("/applets", triggerRoutes({ db, now }))
		.route("/runs", runRoutes({ db, hub }))
		.route("/settings", settingsRoutes({ db, catalogue, dataDir: configuration.dataDir, logger }))
		.route(
			"/services",
			serviceRoutes({ db, catalogue, dataDir: configuration.dataDir, logger, pkce }),
		);

	const app = new Hono<AppEnv>()
		.use(requestSourceMiddleware(deps.clientAddress, configuration.trustedProxies))
		// Before `/api`, so a webhook answers before the session and JSON middleware can run: its
		// token is its only credential, and it takes any content type (ADR-0018 §5).
		.route(WEBHOOK_PATH, webhookRoute({ db, runs, logger }))
		.route("/api", api)
		.all("/api/*", () => notFound("That API route"));
	app.onError(errorResponse(logger));

	const webRoot = deps.webRoot ?? DEFAULT_WEB_ROOT;
	if (existsSync(join(webRoot, "index.html"))) {
		// The SPA owns every other path, including the OAuth return at `/services/:service`.
		app.use("*", serveStatic({ root: webRoot }));
		app.get("*", serveStatic({ root: webRoot, path: "index.html" }));
	} else {
		logger.warn(
			`No built UI at ${webRoot}; serving the API only. Run \`bun run build\` in packages/web.`,
		);
	}
	// Built here because it submits through the same run starter as run now and the webhook.
	const scheduler = createScheduler({ db, runs, now, logger });
	return { app, scheduler, runs };
}

export type App = Awaited<ReturnType<typeof createApp>>["app"];
