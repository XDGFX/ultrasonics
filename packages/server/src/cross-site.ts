import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const JSON_REQUIRED_MESSAGE =
	"This request must have Content-Type: application/json, so another site cannot send it";

/**
 * ADR-0030: a mutating request without a JSON content type is `415`. A cross-origin JSON request
 * needs a preflight, and the server sends no CORS headers, so the preflight never succeeds.
 */
export const requireJson: MiddlewareHandler = async (c, next) => {
	if (SAFE_METHODS.has(c.req.method)) return next();
	const mediaType = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
	if (mediaType !== "application/json") return c.json({ message: JSON_REQUIRED_MESSAGE }, 415);
	return next();
};
