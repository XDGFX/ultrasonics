import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, ClientAddress } from "./app-env.ts";
import { type IpRange, inRanges } from "./ip-range.ts";

/** Records where each request came from, and whether that address is a trusted proxy. */
export function requestSourceMiddleware(
	clientAddress: ClientAddress,
	trustedProxies: readonly IpRange[],
): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const address = clientAddress(c);
		c.set("source", { address, trusted: inRanges(address, trustedProxies) });
		await next();
	};
}

/**
 * The origin the browser used, from `Host`, with `X-Forwarded-Proto` and `X-Forwarded-Host` honoured
 * only from a trusted proxy (ADR-0015 §4).
 */
export function requestOrigin(c: Context<AppEnv>): string {
	const url = new URL(c.req.url);
	const forwarded = (name: string) =>
		c.var.source.trusted ? c.req.header(name)?.split(",")[0]?.trim() || undefined : undefined;
	const protocol = forwarded("X-Forwarded-Proto") ?? url.protocol.replace(/:$/, "");
	const host = forwarded("X-Forwarded-Host") ?? c.req.header("Host") ?? url.host;
	return `${protocol}://${host}`;
}
