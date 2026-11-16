import type { Log } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A timeout is a network error like any other (spec #136, as Plex's in #114). */
const timeoutMs = 30_000;

/** A `429` is retried at most this often per request, and waited out at most this long per run. */
export const rateLimit = { retriesPerRequest: 3, totalWaitMs: 120_000 } as const;

/** Spotify sends `Retry-After` on a `429`; one second when it doesn't, or sends nonsense. */
const defaultRetryAfterMs = 1_000;

/**
 * Why a request failed. `invalid-credentials`: Spotify refused the token (401). `unreachable`: no
 * answer at all. `rate-limited`: a `429` past the retry bounds. `service-error`: any other refusal.
 */
export type SpotifyErrorCode =
	| "invalid-credentials"
	| "unreachable"
	| "rate-limited"
	| "service-error";

export class SpotifyError extends Error {
	constructor(
		readonly code: SpotifyErrorCode,
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "SpotifyError";
	}
}

export interface SpotifyClientOptions {
	/** The Web API base, such as `https://api.spotify.com/v1`. */
	apiBase: string;
	/** Asked before every request, so a run longer than a token's life never sends a stale one. */
	accessToken(): Promise<string>;
	log: Log;
	sleep(ms: number): Promise<void>;
}

const Page = z.object({ items: z.array(z.unknown()), next: z.string().nullish() });

/**
 * The Spotify Web API for one run. The token travels only in the `Authorization` header, so no
 * request URL, log line or error carries it. The rate-limit budget is the run's.
 */
export class SpotifyClient {
	readonly #base: string;
	readonly #options: SpotifyClientOptions;
	#waitedMs = 0;

	constructor(options: SpotifyClientOptions) {
		this.#options = options;
		this.#base = options.apiBase.replace(/\/+$/, "");
	}

	/** One resource, read as `schema`. */
	async get<T extends z.ZodType>(
		schema: T,
		path: string,
		query: Record<string, string> = {},
	): Promise<z.output<T>> {
		const url = new URL(`${this.#base}${path}`);
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
		return this.#read(schema, url, path);
	}

	/** Every item of a paged list, page by page, following Spotify's `next`. */
	async all(path: string, query: Record<string, string> = {}): Promise<unknown[]> {
		const items: unknown[] = [];
		let page = await this.get(Page, path, query);
		items.push(...page.items);
		while (page.next) {
			// `next` is absolute; the token goes nowhere but the API it was issued for.
			if (!page.next.startsWith(`${this.#base}/`)) {
				throw new SpotifyError("service-error", `Spotify paged ${path} to another address`);
			}
			page = await this.#read(Page, new URL(page.next), path);
			items.push(...page.items);
		}
		return items;
	}

	async #read<T extends z.ZodType>(schema: T, url: URL, path: string): Promise<z.output<T>> {
		const response = await this.#send(url, path);
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new SpotifyError(
				"service-error",
				`Spotify answered GET ${path} with something other than JSON`,
			);
		}
		const parsed = schema.safeParse(body);
		if (!parsed.success) {
			throw new SpotifyError(
				"service-error",
				`Spotify answered GET ${path} in an unexpected shape`,
			);
		}
		return parsed.data;
	}

	async #send(url: URL, path: string): Promise<Response> {
		const where = `GET ${path}`;
		for (let retries = 0; ; retries += 1) {
			const token = await this.#options.accessToken();
			let response: Response;
			try {
				response = await fetch(url, {
					headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(timeoutMs),
				});
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				throw new SpotifyError(
					"unreachable",
					`Could not reach Spotify (${where}): ${reason.replaceAll(token, "[token]")}`,
				);
			}
			if (response.status === 429) {
				await response.body?.cancel();
				const waitMs = retryAfterMs(response.headers.get("Retry-After"));
				if (retries >= rateLimit.retriesPerRequest) {
					throw new SpotifyError(
						"rate-limited",
						`Spotify kept rate-limiting ${where} after ${rateLimit.retriesPerRequest} retries`,
						429,
					);
				}
				if (this.#waitedMs + waitMs > rateLimit.totalWaitMs) {
					throw new SpotifyError(
						"rate-limited",
						`Spotify asked to wait ${waitMs / 1000} s on ${where}, past this run's ${rateLimit.totalWaitMs / 1000} s allowance for rate limits`,
						429,
					);
				}
				this.#waitedMs += waitMs;
				this.#options.log.info(
					`Spotify is rate-limiting ${where}; waiting ${waitMs / 1000} s before retrying`,
				);
				await this.#options.sleep(waitMs);
				continue;
			}
			if (response.status === 401) {
				await response.body?.cancel();
				throw new SpotifyError(
					"invalid-credentials",
					"Spotify refused the access token. Reconnect Spotify.",
					401,
				);
			}
			if (!response.ok) {
				await response.body?.cancel();
				throw new SpotifyError(
					"service-error",
					`Spotify answered ${where} with HTTP ${response.status}`,
					response.status,
				);
			}
			return response;
		}
	}
}

/** `Retry-After` in seconds, as Spotify sends it. */
function retryAfterMs(header: string | null): number {
	const seconds = Number(header);
	return header !== null && Number.isFinite(seconds) && seconds >= 0
		? Math.ceil(seconds * 1000)
		: defaultRetryAfterMs;
}
