import { withMeta } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

/** A timeout is a network error like any other, and nothing retries (spec #114). */
const timeoutMs = 30_000;

/**
 * The most of one response body that is read: room for a 10,000-track playlist's items (about
 * 12 MiB), even from a richly tagged library.
 */
export const maxResponseBytes = 64 * 1024 * 1024;

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
	summary: z.string().optional(),
});
export type PlexPlaylist = z.output<typeof PlexPlaylist>;

/**
 * Items read per request. Plex asks clients to page playlist items, and may answer with a
 * different count than asked.
 */
export const itemsPageSize = 200;

/** One page of a playlist's items, and how many it holds in all when Plex says. */
const ItemsPage = z
	.object({
		MediaContainer: z.object({
			totalSize: z.number().optional(),
			Metadata: z.array(PlexTrack).optional(),
		}),
	})
	.transform(({ MediaContainer }) => ({
		items: MediaContainer.Metadata ?? [],
		totalSize: MediaContainer.totalSize,
	}));

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

	/** Every playlist, or only those of `playlistType`, which Plex filters itself. */
	async playlists(playlistType?: "audio"): Promise<PlexPlaylist[]> {
		const query: Record<string, string> = playlistType === undefined ? {} : { playlistType };
		return this.#request(containerOf(PlexPlaylist, "Metadata"), "GET", "/playlists", query);
	}

	/** Every item of one playlist, in order, page by page until `totalSize` or an empty page. */
	async playlistItems(playlistKey: string): Promise<PlexTrack[]> {
		const items: PlexTrack[] = [];
		for (;;) {
			const page = await this.#request(ItemsPage, "GET", `/playlists/${playlistKey}/items`, {
				"X-Plex-Container-Start": String(items.length),
				"X-Plex-Container-Size": String(itemsPageSize),
			});
			items.push(...page.items);
			if (page.items.length === 0 || items.length >= (page.totalSize ?? Infinity)) return items;
		}
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
		if (!parsed.success)
			throw new PlexError("service-error", unreadableMessage(`${method} ${path}`));
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
			throw this.#unreachable(where, error);
		}
		if (response.status === 401) {
			throw new PlexError(
				"invalid-credentials",
				"Plex refused the token. Re-enter your Plex token in the Plex connection.",
				401,
			);
		}
		if (response.status >= 300 && response.status < 400) {
			throw new PlexError("misconfigured", this.#redirectMessage(where), response.status);
		}
		if (!response.ok) {
			throw new PlexError(
				"service-error",
				`Plex answered ${where} with HTTP ${response.status}`,
				response.status,
			);
		}
		let text: string;
		try {
			text = await readCapped(response, where);
		} catch (error) {
			// A body cut off partway, by a reset or the timeout, is no answer at all.
			throw error instanceof PlexError ? error : this.#unreachable(where, error);
		}
		if (text === "") return {};
		try {
			return JSON.parse(text) as unknown;
		} catch {
			throw new PlexError("service-error", unreadableMessage(where));
		}
	}

	#unreachable(where: string, error: unknown): PlexError {
		const reason = error instanceof Error ? error.message : String(error);
		return new PlexError(
			"unreachable",
			`Could not reach the Plex server at ${this.#base.origin} (${where}): ${this.#redact(reason)}`,
		);
	}

	/** Never names the redirect's target, which is the answer's own content. */
	#redirectMessage(where: string): string {
		return `The Plex server at ${this.#base.origin} redirected ${where}; enter the address Plex answers on`;
	}

	/** A message from the runtime may quote what it was given; the token is never repeated. */
	#redact(message: string): string {
		return message.replaceAll(this.#grant.token, "[token]");
	}
}

/** One message for any answer that isn't Plex's, so what answered can't be told apart by it. */
function unreadableMessage(where: string): string {
	return `Plex answered ${where} with something that isn't a Plex response`;
}

/** The body as text, failing once it passes `maxResponseBytes` rather than reading on. */
async function readCapped(response: Response, where: string): Promise<string> {
	if (response.body === null) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > maxResponseBytes) {
			await reader.cancel().catch(() => {});
			throw new PlexError(
				"service-error",
				`Plex answered ${where} with more than ${maxResponseBytes / 1024 / 1024} MiB`,
			);
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
