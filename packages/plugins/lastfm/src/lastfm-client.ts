import { type Log, withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** The plugin's version, sent in every request's `User-Agent` as Last.fm's API introduction asks. */
export const pluginVersion = "1.0.0";

/** A timeout is a network error like any other (spec #185, as Spotify's in #136). */
const timeoutMs = 30_000;

/**
 * The least time between two requests. Last.fm warns against "several calls per second" and
 * publishes no number; four a second is below that on any reading (spec #185, "Pacing").
 */
export const pacingMs = 250;

/** Error 29 or a `429` is waited out `waitMs` at a time, within these bounds. */
export const rateLimit = { waitMs: 10_000, retriesPerRequest: 3, totalWaitMs: 120_000 } as const;

/** Errors 8, 11 and 16 are Last.fm's own trouble: one retry, `waitMs` later. */
export const temporaryFailure = { waitMs: 5_000, codes: [8, 11, 16] } as const;

/** What a refused key's error tells the user to do. */
export const reenterKey = "Re-enter your key under Services.";

/** Last.fm's codes for a key it refuses: invalid (10) or suspended (26). */
const keyRefused = [10, 26];

/** Last.fm's code for invalid parameters, which is what it answers for a user that doesn't exist. */
const userNotFound = 6;

/** The field of ADR-0013 §1's Last.fm grant. */
export const grantFields = z.object({
	apiKey: withMeta(
		z
			.string()
			.trim()
			// No `i` flag: JSON Schema's `pattern` would drop it, and the form must agree with the server.
			.regex(/^[0-9a-f]{32}$/, "A Last.fm API key is 32 characters, each 0–9 or a–f"),
		{
			title: "API key",
			description:
				"Create one at last.fm/api/account/create; any application name will do. Paste the API key, not the shared secret.",
			secret: true,
		},
	),
});
export type LastfmGrant = z.output<typeof grantFields>;

/**
 * Why a request failed. `user-not-found`: error 6. `key-refused`: errors 10 and 26.
 * `rate-limited`: error 29 or a `429` past the retry bounds. `unreachable`: no answer at all.
 * `service-error`: any other answer.
 */
export type LastfmErrorCode =
	| "user-not-found"
	| "key-refused"
	| "rate-limited"
	| "unreachable"
	| "service-error";

export class LastfmError extends Error {
	constructor(
		readonly code: LastfmErrorCode,
		message: string,
	) {
		super(message);
		this.name = "LastfmError";
	}
}

export interface LastfmClientOptions {
	/** The API root, such as `https://ws.audioscrobbler.com/2.0/`. */
	apiBase: string;
	apiKey: string;
	log: Log;
	sleep(ms: number): Promise<void>;
	/** The clock that paces requests, in epoch milliseconds. */
	now(): number;
}

/** The error Last.fm sends in a body, usually with a 4xx status. */
const ErrorBody = z.object({ error: z.number(), message: z.string().nullish() });

/**
 * Last.fm's API for one run. The key travels in the query string, as Last.fm requires, so no request
 * URL is ever logged or put in an error: only the method name is.
 */
export class LastfmClient {
	readonly #options: LastfmClientOptions;
	#waitedMs = 0;
	#lastRequestAt: number | undefined;

	constructor(options: LastfmClientOptions) {
		this.#options = options;
	}

	/** One call of `method`, its answer read as `schema`. */
	async call<T extends z.ZodType>(
		schema: T,
		method: string,
		params: Record<string, string> = {},
	): Promise<z.output<T>> {
		const url = new URL(this.#options.apiBase);
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		url.searchParams.set("method", method);
		url.searchParams.set("api_key", this.#options.apiKey);
		url.searchParams.set("format", "json");

		let rateLimitRetries = 0;
		let temporaryRetried = false;
		for (;;) {
			const { status, body } = await this.#fetch(url, method);
			const error = ErrorBody.safeParse(body);
			const code = error.success ? error.data.error : undefined;
			if (code === undefined && status === 200) {
				const parsed = schema.safeParse(body);
				if (!parsed.success) {
					throw new LastfmError(
						"service-error",
						`Last.fm answered ${method} in an unexpected shape`,
					);
				}
				return parsed.data;
			}
			const said =
				code === undefined
					? `HTTP ${status}`
					: `error ${code}: ${this.#redact(error.data?.message ?? "no message")}`;
			if (code === userNotFound && params.user !== undefined) {
				throw new LastfmError(
					"user-not-found",
					`No Last.fm user is called ${params.user} (${said})`,
				);
			}
			if (code !== undefined && keyRefused.includes(code)) {
				throw new LastfmError(
					"key-refused",
					`Last.fm refused the API key on ${method} (${said}). ${reenterKey}`,
				);
			}
			if (code === 29 || (code === undefined && status === 429)) {
				this.#checkRateLimitBudget(method, rateLimitRetries);
				rateLimitRetries += 1;
				this.#waitedMs += rateLimit.waitMs;
				this.#options.log.info(
					`Last.fm's rate limit was reached on ${method}; waiting ${rateLimit.waitMs / 1000} s before retrying`,
				);
				await this.#options.sleep(rateLimit.waitMs);
				continue;
			}
			if (code !== undefined && (temporaryFailure.codes as readonly number[]).includes(code)) {
				if (temporaryRetried) {
					throw new LastfmError(
						"service-error",
						`Last.fm failed ${method} twice (${said}); try again later`,
					);
				}
				temporaryRetried = true;
				this.#options.log.info(
					`Last.fm failed ${method} (${said}); retrying in ${temporaryFailure.waitMs / 1000} s`,
				);
				await this.#options.sleep(temporaryFailure.waitMs);
				continue;
			}
			throw new LastfmError("service-error", `Last.fm answered ${method} with ${said}`);
		}
	}

	#checkRateLimitBudget(method: string, retries: number): void {
		if (retries >= rateLimit.retriesPerRequest) {
			throw new LastfmError(
				"rate-limited",
				`Last.fm's rate limit was still reached on ${method} after ${rateLimit.retriesPerRequest} retries`,
			);
		}
		if (this.#waitedMs + rateLimit.waitMs > rateLimit.totalWaitMs) {
			throw new LastfmError(
				"rate-limited",
				`Last.fm's rate limit was reached on ${method}, past this run's ${rateLimit.totalWaitMs / 1000} s allowance for waiting`,
			);
		}
	}

	/** Waits out the pacing, then asks once. A body that isn't JSON fails the call. */
	async #fetch(url: URL, method: string): Promise<{ status: number; body: unknown }> {
		const { now, sleep } = this.#options;
		if (this.#lastRequestAt !== undefined) {
			const wait = this.#lastRequestAt + pacingMs - now();
			if (wait > 0) await sleep(wait);
		}
		this.#lastRequestAt = now();
		let response: Response;
		try {
			response = await fetch(url, {
				headers: { Accept: "application/json", "User-Agent": `ultrasonics/${pluginVersion}` },
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new LastfmError(
				"unreachable",
				`Could not reach Last.fm (${method}): ${this.#redact(reason)}`,
			);
		}
		const text = await response.text().catch(() => "");
		try {
			return { status: response.status, body: JSON.parse(text) };
		} catch {
			// A 429 means the rate limit whatever its body says.
			if (response.status === 429) return { status: 429, body: undefined };
			throw new LastfmError(
				"service-error",
				`Last.fm answered ${method} with HTTP ${response.status} and something other than JSON`,
			);
		}
	}

	/** Text from elsewhere, with the key cut out should it carry it. */
	#redact(text: string): string {
		return text.replaceAll(this.#options.apiKey, "<api key>");
	}
}
