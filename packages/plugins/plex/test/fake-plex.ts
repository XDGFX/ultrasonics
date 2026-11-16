// An in-process Plex Media Server that replays `fixtures/` and records every request it receives.
// Code, so it lives outside `test/fixtures`, where the type-check would not see it.
import { join } from "node:path";

const fixtures = join(import.meta.dir, "fixtures");

/** The token the fake accepts; any other is refused with Plex's 401. */
export const fakeToken = "fake-plex-token-c0ffee";

/** The placeholder the recorded `server-root.json` carries in place of the real server's. */
export const machineIdentifier = "scrubbed-machine-identifier";

/** The one ordinary playlist in `playlists.json` with items: `playlist-items.json`'s. */
export const existingPlaylistKey = "44";

export interface RecordedRequest {
	method: string;
	/** The path and query string, exactly as received. */
	url: string;
	path: string;
	query: URLSearchParams;
	headers: Headers;
}

/** Answers one request, or `undefined` to fall through to the recorded fixtures. */
export type Route = (
	request: RecordedRequest,
) => Response | undefined | Promise<Response | undefined>;

export interface FakePlex {
	url: string;
	requests: RecordedRequest[];
	/** The rating keys the existing playlist holds now, in order, after any writes. */
	existingPlaylist(): string[];
	stop(): Promise<void>;
}

export async function fixture(name: string): Promise<unknown> {
	return Bun.file(join(fixtures, name)).json();
}

interface PlexTrack {
	ratingKey: string;
	title: string;
}

interface PlaylistItem extends PlexTrack {
	playlistItemID: number;
}

/** The music library's tracks. Plex names their section once, on the container, not per track. */
async function library(): Promise<{ section: number; tracks: PlexTrack[] }> {
	const body = (await fixture("library-section-tracks.json")) as {
		MediaContainer: { librarySectionID: number; Metadata: PlexTrack[] };
	};
	return { section: body.MediaContainer.librarySectionID, tracks: body.MediaContainer.Metadata };
}

function container(metadata: unknown[]): Response {
	return Response.json({ MediaContainer: { size: metadata.length, Metadata: metadata } });
}

async function fixtureResponse(name: string): Promise<Response> {
	return Response.json(await fixture(name));
}

/**
 * Plex's `title` filter, as the test server showed it: every word of the query begins a word of the
 * title. Words split on spaces only, case and accents are ignored, and ' differs from ’.
 */
function titleMatches(title: string, query: string): boolean {
	const words = (text: string) =>
		text
			.normalize("NFD")
			.replace(/\p{M}/gu, "")
			.toLowerCase()
			.split(/\s+/)
			.filter((word) => word !== "");
	const titleWords = words(title);
	return words(query).every((word) => titleWords.some((candidate) => candidate.startsWith(word)));
}

/** The rating keys a write names, from its `server://…/library/metadata/<keys>` URI. */
function uriKeys(query: URLSearchParams): string[] {
	return (query.get("uri") ?? "").replace(/^.*\/library\/metadata\//, "").split(",");
}

/**
 * The recorded server: one music library, the playlists in `playlists.json`. The existing
 * playlist's items are live, and an add skips a track it already holds, as Plex 1.43 does.
 */
function recordedServer() {
	// `require` keeps the fake synchronous; the copy gives each fake its own items.
	const items = (
		require(join(fixtures, "playlist-items.json")) as {
			MediaContainer: { Metadata: PlaylistItem[] };
		}
	).MediaContainer.Metadata.map((item) => ({ ...item }));
	let nextItemId = Math.max(...items.map((item) => item.playlistItemID)) + 1;
	const existing = `/playlists/${existingPlaylistKey}/items`;

	async function answer(request: RecordedRequest): Promise<Response> {
		const { method, path, query } = request;
		if (method === "GET" && path === "/") return fixtureResponse("server-root.json");
		if (method === "GET" && path === "/library/sections") {
			return fixtureResponse("library-sections.json");
		}
		const section = /^\/library\/sections\/(\d+)\/all$/.exec(path);
		if (method === "GET" && section && query.get("type") === "10") {
			const music = await library();
			const title = query.get("title") ?? "";
			const size = Number(query.get("X-Plex-Container-Size") ?? Number.POSITIVE_INFINITY);
			const found =
				String(music.section) === section[1]
					? music.tracks.filter((track) => titleMatches(track.title, title))
					: [];
			return container(found.slice(0, size));
		}
		const metadata = /^\/library\/metadata\/(\d+)$/.exec(path);
		if (method === "GET" && metadata) {
			const music = await library();
			const track = music.tracks.find((candidate) => candidate.ratingKey === metadata[1]);
			// One item's metadata names its section on the item (`library-metadata.json`).
			return track
				? container([{ ...track, librarySectionID: music.section }])
				: new Response("Not Found", { status: 404 });
		}
		if (method === "GET" && path === "/playlists") return fixtureResponse("playlists.json");
		if (method === "GET" && path === existing) return container(items);
		if (method === "POST" && path === "/playlists") return fixtureResponse("playlist-created.json");
		if (method === "PUT" && path === existing) {
			const { tracks } = await library();
			for (const key of uriKeys(query)) {
				const track = tracks.find((candidate) => candidate.ratingKey === key);
				if (track && !items.some((item) => item.ratingKey === key)) {
					items.push({ ...track, playlistItemID: nextItemId++ });
				}
			}
			return fixtureResponse("playlist-items-added.json");
		}
		if (method === "PUT" && /^\/playlists\/\d+\/items$/.test(path)) {
			return fixtureResponse("playlist-items-added.json");
		}
		const item = new RegExp(`^${existing}/(\\d+)(/move)?$`).exec(path);
		const at = items.findIndex((candidate) => String(candidate.playlistItemID) === item?.[1]);
		if (item && at === -1) return new Response("Not Found", { status: 404 });
		if (method === "DELETE" && item && !item[2]) {
			items.splice(at, 1);
			return container([]);
		}
		if (method === "PUT" && item?.[2]) {
			const after = query.get("after");
			const [moved] = items.splice(at, 1);
			const to =
				after === null ? 0 : items.findIndex((c) => String(c.playlistItemID) === after) + 1;
			if (moved === undefined || (to === 0 && after !== null)) {
				return new Response("Bad Request", { status: 400 });
			}
			items.splice(to, 0, moved);
			return container([]);
		}
		return new Response("Not Found", { status: 404 });
	}

	return { answer, keys: () => items.map((item) => item.ratingKey) };
}

/** Starts the fake on a free local port. `routes` are tried in order before the recorded server. */
export function startFakePlex(routes: Route[] = []): FakePlex {
	const recorded = recordedServer();
	const requests: RecordedRequest[] = [];
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(raw) {
			const url = new URL(raw.url);
			const request: RecordedRequest = {
				method: raw.method,
				url: `${url.pathname}${url.search}`,
				path: url.pathname,
				query: url.searchParams,
				headers: raw.headers,
			};
			requests.push(request);
			if (raw.headers.get("X-Plex-Token") !== fakeToken) {
				return new Response(Bun.file(join(fixtures, "unauthorised.html")), {
					status: 401,
					headers: { "Content-Type": "text/html" },
				});
			}
			for (const route of routes) {
				const response = await route(request);
				if (response) return response;
			}
			return recorded.answer(request);
		},
	});
	return {
		url: server.url.href,
		requests,
		existingPlaylist: recorded.keys,
		stop: () => server.stop(true),
	};
}

/** Answers `method path` (a path or a pattern) with `response`, leaving every other request alone. */
export function on(method: string, path: string | RegExp, response: () => Response): Route {
	return (request) =>
		request.method === method &&
		(typeof path === "string" ? request.path === path : path.test(request.path))
			? response()
			: undefined;
}

/** A URL nothing listens on: the fake, started and stopped. */
export async function unreachableUrl(): Promise<string> {
	const fake = startFakePlex();
	await fake.stop();
	return fake.url;
}
