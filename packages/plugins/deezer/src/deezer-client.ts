import type { Log } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A timeout is a network error like any other (spec #184, as Spotify's in #136). */
const timeoutMs = 30_000;

/**
 * Deezer's code 4 ("Quota limit exceeded") is waited out `waitMs` at a time, at most
 * `retriesPerRequest` times per request and `totalWaitMs` per run. Deezer publishes no rate.
 */
export const quota = { waitMs: 5_000, retriesPerRequest: 3, totalWaitMs: 60_000 } as const;

/**
 * Why a request failed. `unavailable`: Deezer has no public playlist there (code 800, or an
 * `OAuthException`). `quota`: code 4 past the retry bounds. `unreachable`: no answer at all.
 * `service-error`: any other answer.
 */
export type DeezerErrorCode = "unavailable" | "quota" | "unreachable" | "service-error";

export class DeezerError extends Error {
	constructor(
		readonly code: DeezerErrorCode,
		message: string,
	) {
		super(message);
		this.name = "DeezerError";
	}
}

export interface DeezerClientOptions {
	/** The API base, such as `https://api.deezer.com`. */
	apiBase: string;
	log: Log;
	sleep(ms: number): Promise<void>;
}

/** The error Deezer sends inside a 200 body. */
const ErrorBody = z.object({
	error: z.object({
		type: z.string().nullish(),
		message: z.string().nullish(),
		code: z.number().nullish(),
	}),
});

const Page = z.object({ data: z.array(z.unknown()), next: z.string().nullish() });

/** Deezer's public API for one run, with no token. The quota budget is the run's. */
export class DeezerClient {
	readonly #base: string;
	readonly #options: DeezerClientOptions;
	#waitedMs = 0;

	constructor(options: DeezerClientOptions) {
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

	/** Every item of a paged list, page by page, following Deezer's `next`. */
	async all(path: string, query: Record<string, string> = {}): Promise<unknown[]> {
		let page = await this.get(Page, path, query);
		const items = [...page.data];
		while (page.next) {
			if (!page.next.startsWith(`${this.#base}/`)) {
				throw new DeezerError("service-error", `Deezer paged ${path} to another address`);
			}
			page = await this.#read(Page, new URL(page.next), path);
			items.push(...page.data);
		}
		return items;
	}

	async #read<T extends z.ZodType>(schema: T, url: URL, path: string): Promise<z.output<T>> {
		const where = `GET ${path}`;
		for (let retries = 0; ; retries += 1) {
			const body = await this.#body(url, where);
			const error = ErrorBody.safeParse(body);
			if (!error.success) {
				const parsed = schema.safeParse(body);
				if (!parsed.success) {
					throw new DeezerError("service-error", `Deezer answered ${where} in an unexpected shape`);
				}
				return parsed.data;
			}
			const { type, message, code } = error.data.error;
			const said = `${type ?? "error"} ${code ?? "?"}: ${message ?? "no message"}`;
			if (code === 800 || type === "OAuthException") {
				throw new DeezerError("unavailable", `Deezer answered ${where} with ${said}`);
			}
			if (code !== 4)
				throw new DeezerError("service-error", `Deezer answered ${where} with ${said}`);
			if (retries >= quota.retriesPerRequest) {
				throw new DeezerError(
					"quota",
					`Deezer's quota was still exceeded on ${where} after ${quota.retriesPerRequest} retries`,
				);
			}
			if (this.#waitedMs + quota.waitMs > quota.totalWaitMs) {
				throw new DeezerError(
					"quota",
					`Deezer's quota was exceeded on ${where}, past this run's ${quota.totalWaitMs / 1000} s allowance for waiting`,
				);
			}
			this.#waitedMs += quota.waitMs;
			this.#options.log.info(
				`Deezer's quota is exceeded on ${where}; waiting ${quota.waitMs / 1000} s before retrying`,
			);
			await this.#options.sleep(quota.waitMs);
		}
	}

	async #body(url: URL, where: string): Promise<unknown> {
		let response: Response;
		try {
			response = await fetch(url, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new DeezerError("unreachable", `Could not reach Deezer (${where}): ${reason}`);
		}
		if (response.status !== 200) {
			await response.body?.cancel();
			throw new DeezerError(
				"service-error",
				`Deezer answered ${where} with HTTP ${response.status}`,
			);
		}
		try {
			return await response.json();
		} catch {
			throw new DeezerError(
				"service-error",
				`Deezer answered ${where} with something other than JSON`,
			);
		}
	}
}
