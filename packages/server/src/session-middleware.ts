import type { OpenDatabase } from "@ultrasonics/db";
import { authStore } from "@ultrasonics/db/auth-store";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./app-env.ts";
import type { BootableAuthSource } from "./configuration.ts";
import { isPrivateAddress } from "./ip-range.ts";
import type { Logger } from "./logger.ts";

export interface SessionOptions {
	db: OpenDatabase;
	authSource: BootableAuthSource;
	proxyUserHeader: string;
	logger: Logger;
}

export const PROXY_REFUSAL_MESSAGE =
	"Sign in through the reverse proxy in front of ultrasonics; this request did not come through it";

/**
 * The one session middleware (ADR-0007 §3, ADR-0015). It always sets a `Session` or answers `401`;
 * nothing falls back to another source. Every source resolves to the install's one account, read
 * once here.
 */
export async function sessionMiddleware(
	options: SessionOptions,
): Promise<MiddlewareHandler<AppEnv>> {
	const accountId = await authStore(options.db).installAccount();
	const { logger, proxyUserHeader } = options;
	const session = { accountId };

	if (options.authSource === "bootstrapped") {
		/** Public addresses already warned about, once each per boot, so the log is not flooded. */
		const warned = new Set<string>();
		return async (c, next) => {
			const { address } = c.var.source;
			const exposed = address !== undefined && !isPrivateAddress(address);
			if (exposed && !warned.has(address)) {
				warned.add(address);
				logger.warn(
					`A request reached this bootstrapped install from the public address ${address}. Anyone who can reach it can use it; put a login in front with AUTH_SOURCE=proxy if that is not what you want.`,
				);
			}
			c.set("exposed", exposed);
			c.set("session", session);
			await next();
		};
	}

	return async (c, next) => {
		const user = c.req.header(proxyUserHeader)?.trim();
		if (!c.var.source.trusted || !user) {
			return c.json({ message: PROXY_REFUSAL_MESSAGE }, 401);
		}
		// The proxy authorises; it does not identify (ADR-0015 §5). Logged for audit, never stored.
		logger.info(`proxy user "${user}": ${c.req.method} ${c.req.path}`);
		c.set("exposed", false);
		c.set("session", session);
		await next();
	};
}
