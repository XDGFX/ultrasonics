import type { OpenDatabase } from "@ultrasonics/db";
import { systemModule } from "@ultrasonics/db/system";
import { type Context, Hono } from "hono";
import type { WebhookFired } from "./api.ts";
import type { AppEnv } from "./app-env.ts";
import { errorResponse } from "./error-response.ts";
import type { Logger } from "./logger.ts";
import type { RunStarter } from "./run-starter.ts";
import { webhookTokenHash } from "./webhook-token.ts";

/** Where the webhook is mounted; with the token after it, the URL the owner is given. */
export const WEBHOOK_PATH = "/api/hooks";

/** One answer for an unknown token and a revoked one, so a guess learns nothing (ADR-0018 §5). */
const UNKNOWN_TOKEN = { message: "No applet has that webhook" };

/**
 * The inbound webhook, `/api/hooks`: the only unauthenticated route that starts work in an account.
 * The token alone names the applet, and the applet's account scopes the run. Mounted outside the
 * session middleware and ADR-0030's JSON rule, and the body is never read: Plex sends multipart.
 */
export function webhookRoute(deps: { db: OpenDatabase; runs: RunStarter; logger: Logger }) {
	const { db, runs, logger } = deps;
	const system = systemModule(db);

	async function fire(c: Context<AppEnv>, token: string | undefined) {
		const owned = token ? await system.appletForWebhookToken(webhookTokenHash(token)) : undefined;
		if (!owned) return c.json(UNKNOWN_TOKEN, 404);
		if (!owned.enabled) {
			// Queuing nothing, loudly, rather than hiding a misconfigured automation.
			return c.json({ message: "That applet is disabled, so its webhook does not run it" }, 409);
		}
		const result = await runs.submit(owned.accountId, owned.appletId, "webhook");
		if (!result) return c.json(UNKNOWN_TOKEN, 404);
		return c.json({ status: result.kind } satisfies WebhookFired, 202);
	}

	const bearerOf = (header: string | undefined) => header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];

	return (
		new Hono<AppEnv>()
			// The path is the token, a live credential: a failure is logged without it.
			.onError(errorResponse(logger, WEBHOOK_PATH))
			// GET because some tools can send nothing else.
			.get("/:token", (c) => fire(c, c.req.param("token")))
			.post("/:token", (c) => fire(c, c.req.param("token")))
			.post("/", (c) => fire(c, bearerOf(c.req.header("Authorization"))))
			// Anything else ends here too: `/api`'s middleware would log the path.
			.all("/*", (c) => c.json(UNKNOWN_TOKEN, 404))
	);
}
