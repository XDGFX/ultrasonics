import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A timeout is a network error like any other, and nothing retries (spec #114). */
const timeoutMs = 30_000;

/** Fixed, so Plex lists ultrasonics as one device however many runs connect. */
const clientIdentifier = "ultrasonics-plex-plugin";

/**
 * The fields of ADR-0013 §1's Plex grant. A regex, not `.url()`: a string format can't be rendered
 * (ADR-0019).
 */
export const grantFields = z.object({
	serverUrl: withMeta(z.string().regex(/^https?:\/\/\S+$/), {
		title: "Server URL",
		description: "Your Plex Media Server's address, with its port.",
		placeholder: "http://192.168.1.10:32400",
	}),
	token: withMeta(z.string().min(1), {
		title: "Plex token",
		description: "The X-Plex-Token for an account that can edit playlists on this server.",
		secret: true,
	}),
	verifyTls: withMeta(z.boolean().default(true), {
		title: "Verify the TLS certificate",
		description: "Turn off for a server with a self-signed certificate.",
	}),
});
export type PlexGrant = z.output<typeof grantFields>;

/**
 * Why a Plex request failed. `invalid-credentials`: Plex refused the token (401). `unreachable`: no
 * answer at all. `service-error`: any other refusal. `misconfigured`: the settings name nothing,
 * or the server URL redirects.
 */
export type PlexErrorCode =
	| "invalid-credentials"
	| "unreachable"
	| "service-error"
	| "misconfigured";

export class PlexError extends Error {
	constructor(
		readonly code: PlexErrorCode,
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "PlexError";
	}
}

/** Plex sends its keys and ids as strings or numbers, depending on the endpoint. */
const key = z.union([z.string(), z.number()]).transform(String);

/** A library item as Plex lists it; the fields the song mapping reads. */
export const PlexTrack = z.object({
	ratingKey: key,
	type: z.string().optional(),
	title: z.string().optional(),
	originalTitle: z.string().optional(),
	grandparentTitle: z.string().optional(),
	parentTitle: z.string().optional(),
	duration: z.number().optional(),
	originallyAvailableAt: z.string().optional(),
	year: z.number().optional(),
	parentYear: z.number().optional(),
	librarySectionID: key.optional(),
	playlistItemID: key.optional(),
	Media: z
		.array(z.object({ Part: z.array(z.object({ file: z.string().optional() })).optional() }))
		.optional(),
});
export type PlexTrack = z.output<typeof PlexTrack>;

const Library = z.object({ key: z.string(), type: z.string(), title: z.string() });
export type Library = z.output<typeof Library>;

const PlexPlaylist = z.object({
	ratingKey: key,
	title: z.string(),
	smart: z
		.union([z.boolean(), z.literal(0), z.literal(1)])
		.transform(Boolean)
		.optional(),
	playlistType: z.string().optional(),
});
export type PlexPlaylist = z.output<typeof PlexPlaylist>;

/** Plex leaves `Metadata` out of an empty container rather than sending `[]`. */
function containerOf<T extends z.ZodType>(item: T, key: "Metadata" | "Directory") {
	return z
		.object({ MediaContainer: z.object({ [key]: z.array(item).optional() }) })
		.transform((body) => (body.MediaContainer[key] ?? []) as z.output<T>[]);
}

const tracks = containerOf(PlexTrack, "Metadata");

const Identity = z.object({ MediaContainer: z.object({ machineIdentifier: z.string().min(1) }) });

/**
 * One Plex Media Server, spoken to over its HTTP API. The token travels only in the `X-Plex-Token`
 * header, and no message names a URL with a query, so neither a log line nor an error carries it.
 */
export class PlexClient {
	readonly #base: URL;
	readonly #grant: PlexGrant;
	#machineIdentifier = "";

	private constructor(grant: PlexGrant) {
		this.#grant = grant;
		const base = new URL(grant.serverUrl);
		base.search = "";
		base.hash = "";
		if (!base.pathname.endsWith("/")) base.pathname += "/";
		this.#base = base;
	}

	/** Asks the server who it is, which also proves the token; throws a `PlexError` if it can't. */
	static async connect(grant: PlexGrant): Promise<PlexClient> {
		const client = new PlexClient(grant);
		const body = await client.#request(Identity, "GET", "/");
		client.#machineIdentifier = body.MediaContainer.machineIdentifier;
		return client;
	}

	/** The server's own name for itself, which keys its ID space (`plex:<machineIdentifier>`). */
	get machineIdentifier(): string {
		return this.#machineIdentifier;
	}

	async libraries(): Promise<Library[]> {
		return this.#request(containerOf(Library, "Directory"), "GET", "/library/sections");
	}

	/** Tracks in one library whose title contains `title`, at most `limit` of them. */
	async searchTracks(libraryKey: string, title: string, limit: number): Promise<PlexTrack[]> {
		return this.#request(tracks, "GET", `/library/sections/${libraryKey}/all`, {
			type: "10",
			title,
			"X-Plex-Container-Start": "0",
			"X-Plex-Container-Size": String(limit),
		});
	}

	/** One library item by its rating key, or `undefined` when the server has none. */
	async item(ratingKey: string): Promise<PlexTrack | undefined> {
		try {
			const path = `/library/metadata/${encodeURIComponent(ratingKey)}`;
			const [item] = await this.#request(tracks, "GET", path);
			return item;
		} catch (error) {
			if (error instanceof PlexError && error.status === 404) return undefined;
			throw error;
		}
	}

	async playlists(): Promise<PlexPlaylist[]> {
		return this.#request(containerOf(PlexPlaylist, "Metadata"), "GET", "/playlists");
	}

	async playlistItems(playlistKey: string): Promise<PlexTrack[]> {
		return this.#request(tracks, "GET", `/playlists/${playlistKey}/items`);
	}

	/** Creates an audio playlist holding `ratingKeys`, which must not be empty: Plex refuses that. */
	async createPlaylist(title: string, ratingKeys: string[]): Promise<string> {
		const query = { uri: this.#itemsUri(ratingKeys), type: "audio", title, smart: "0" };
		const playlists = containerOf(PlexPlaylist, "Metadata");
		const [created] = await this.#request(playlists, "POST", "/playlists", query);
		if (created === undefined) {
			throw new PlexError("service-error", `Plex created the playlist "${title}" but named none`);
		}
		return created.ratingKey;
	}

	async addToPlaylist(playlistKey: string, ratingKeys: string[]): Promise<void> {
		const path = `/playlists/${playlistKey}/items`;
		await this.#request(z.unknown(), "PUT", path, { uri: this.#itemsUri(ratingKeys) });
	}

	async removeFromPlaylist(playlistKey: string, playlistItemId: string): Promise<void> {
		const path = `/playlists/${playlistKey}/items/${playlistItemId}`;
		await this.#request(z.unknown(), "DELETE", path);
	}

	/** Moves one playlist item to just after another, or to the top when `afterItemId` is absent. */
	async moveInPlaylist(playlistKey: string, playlistItemId: string, afterItemId?: string) {
		const path = `/playlists/${playlistKey}/items/${playlistItemId}/move`;
		const query: Record<string, string> = afterItemId === undefined ? {} : { after: afterItemId };
		await this.#request(z.unknown(), "PUT", path, query);
	}

	/** Plex addresses library items to a playlist as one URI naming every rating key. */
	#itemsUri(ratingKeys: string[]): string {
		const root = `server://${this.#machineIdentifier}/com.plexapp.plugins.library`;
		return `${root}/library/metadata/${ratingKeys.join(",")}`;
	}

	/** Sends one request and reads its JSON as `schema`; every failure is a `PlexError`. */
	async #request<T extends z.ZodType>(
		schema: T,
		method: string,
		path: string,
		query: Record<string, string> = {},
	): Promise<z.output<T>> {
		const body = await this.#send(method, path, query);
		const parsed = schema.safeParse(body);
		if (!parsed.success) {
			throw new PlexError(
				"service-error",
				`Plex answered ${method} ${path} in an unexpected shape`,
			);
		}
		return parsed.data;
	}

	async #send(method: string, path: string, query: Record<string, string>): Promise<unknown> {
		const url = new URL(path.replace(/^\//, ""), this.#base);
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
		const where = `${method} ${path}`;
		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers: {
					Accept: "application/json",
					"X-Plex-Token": this.#grant.token,
					"X-Plex-Client-Identifier": clientIdentifier,
					"X-Plex-Product": "ultrasonics",
				},
				// Bun keeps a custom header across origins, so following would hand the token on.
				redirect: "manual",
				signal: AbortSignal.timeout(timeoutMs),
				tls: { rejectUnauthorized: this.#grant.verifyTls },
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new PlexError(
				"unreachable",
				`Could not reach the Plex server at ${this.#base.origin} (${where}): ${this.#redact(reason)}`,
			);
		}
		if (response.status === 401) {
			throw new PlexError(
				"invalid-credentials",
				"Plex refused the token. Re-enter your Plex token in the Plex connection.",
				401,
			);
		}
		if (response.status >= 300 && response.status < 400) {
			throw new PlexError(
				"misconfigured",
				this.#redirectMessage(where, url, response),
				response.status,
			);
		}
		if (!response.ok) {
			throw new PlexError(
				"service-error",
				`Plex answered ${where} with HTTP ${response.status}`,
				response.status,
			);
		}
		const text = await response.text();
		if (text === "") return {};
		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw new PlexError("service-error", `Plex answered ${where} with something other than JSON`);
		}
	}

	/** Names where a redirect pointed by origin alone, so no query the target carried is repeated. */
	#redirectMessage(where: string, url: URL, response: Response): string {
		const from = `The Plex server at ${this.#base.origin} redirected ${where}`;
		const advice = "enter the address Plex answers on";
		const location = response.headers.get("Location");
		let target: string | undefined;
		try {
			target = location === null ? undefined : new URL(location, url).origin;
		} catch {
			target = undefined;
		}
		return target === undefined ? `${from}; ${advice}` : `${from} to ${target}; ${advice}`;
	}

	/** A message from the runtime may quote what it was given; the token is never repeated. */
	#redact(message: string): string {
		return message.replaceAll(this.#grant.token, "[token]");
	}
}
