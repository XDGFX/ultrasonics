import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/bun";
import type { RunQueue } from "@ultrasonics/core";
import type { OpenDatabase } from "@ultrasonics/db";
import { Hono } from "hono";
import { z } from "zod";
import type { InstanceInfo, RunSummary } from "./api.ts";
import type { AppEnv, ClientAddress } from "./app-env.ts";
import { appletRoutes } from "./applet-routes.ts";
import type { Catalogue } from "./catalogue.ts";
import type { Configuration } from "./configuration.ts";
import { requireJson } from "./cross-site.ts";
import { errorResponse, notFound } from "./error-response.ts";
import type { Logger } from "./logger.ts";
import { requestSourceMiddleware } from "./request-source.ts";
import { serviceRoutes } from "./service-routes.ts";
import { sessionMiddleware } from "./session-middleware.ts";
import { settingsRoutes } from "./settings-routes.ts";
import { pathParams } from "./validation.ts";

/** Where `packages/web` builds the UI, relative to this file in the repo and in the image. */
export const DEFAULT_WEB_ROOT = fileURLToPath(new URL("../../web/dist", import.meta.url));

export interface AppDeps {
	configuration: Pick<
		Configuration,
		"authSource" | "trustedProxies" | "proxyUserHeader" | "dataDir"
	>;
	db: OpenDatabase;
	catalogue: Catalogue;
	queue: RunQueue;
	clientAddress: ClientAddress;
	logger: Logger;
	/** The built UI; absent or missing on disk, only the API is served. */
	webRoot?: string;
}

/**
 * The whole HTTP surface as one Hono app, built from its dependencies so tests drive it in-process
 * with `app.request()` (ADR-0024).
 */
export async function createApp(deps: AppDeps) {
	const { configuration, db, catalogue, queue, logger } = deps;
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
		.route("/applets", appletRoutes({ db, catalogue, queue }))
		.get("/runs/:id", pathParams(z.object({ id: z.string() })), async (c) => {
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
		.route("/settings", settingsRoutes({ db, catalogue }))
		.route("/services", serviceRoutes({ db, catalogue, dataDir: configuration.dataDir, logger }));

	const app = new Hono<AppEnv>()
		.use(requestSourceMiddleware(deps.clientAddress, configuration.trustedProxies))
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
	return app;
}

export type App = Awaited<ReturnType<typeof createApp>>;
