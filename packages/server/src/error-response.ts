import { CredentialKeyMismatchError } from "@ultrasonics/db";
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import {
	AuthFailureError,
	FlowMismatchError,
	NotYetAvailableError,
} from "./auth/local-auth-provider.ts";
import type { Logger } from "./logger.ts";

export const UNEXPECTED_ERROR_MESSAGE =
	"Something went wrong on the server; its log has the details";

/**
 * Every error a route throws, as `{ message }`. A stack is logged, never returned. `loggedPath`
 * stands in for the request's path in the log, for a route whose path holds a credential.
 */
export function errorResponse(logger: Logger, loggedPath?: string): ErrorHandler {
	return (error, c) => {
		if (error instanceof HTTPException) return c.json({ message: error.message }, error.status);
		if (error instanceof FlowMismatchError) return c.json({ message: error.message }, 400);
		if (error instanceof NotYetAvailableError) return c.json({ message: error.message }, 501);
		// `begin` before the operator registered a client: the wizard's `client` step comes first.
		if (error instanceof AuthFailureError) return c.json({ message: error.message }, 409);
		if (error instanceof CredentialKeyMismatchError) {
			// A lost key is the operator's problem, not a reconnect (#109).
			logger.error(error.message);
			return c.json({ message: error.message }, 500);
		}
		logger.error(`${c.req.method} ${loggedPath ?? c.req.path} failed`, error);
		return c.json({ message: UNEXPECTED_ERROR_MESSAGE }, 500);
	};
}

/** Throws a `404` with a message the UI can show. */
export function notFound(what: string): never {
	throw new HTTPException(404, { message: `${what} was not found` });
}
