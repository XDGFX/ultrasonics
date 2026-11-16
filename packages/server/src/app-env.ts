import type { Context } from "hono";

/** Which account a request acts for (ADR-0007 §3). The core never sees it. */
export interface Session {
	accountId: string;
}

/** Where a request came from, as the connection reports it, and whether to believe its proxy. */
export interface RequestSource {
	address: string | undefined;
	/** The address is inside `TRUSTED_PROXIES`, so its `X-Forwarded-*` headers are honoured. */
	trusted: boolean;
}

/** The typed context every route reads; `session` is set on every `/api` route but the hooks. */
export interface AppEnv {
	Variables: {
		source: RequestSource;
		session: Session;
	};
}

/** The connection's remote address. Production passes Hono's `getConnInfo`; tests pass their own. */
export type ClientAddress = (c: Context) => string | undefined;
