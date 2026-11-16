// An in-process Spotify Web API that replays `fixtures/` and records every request it receives.
// Code, so it lives outside `test/fixtures`, where the type-check would not see it.
import { join } from "node:path";

const fixtures = join(import.meta.dir, "fixtures");

/** The access token the fake accepts; any other is refused with Spotify's 401. */
export const fakeToken = "BQfake-spotify-access-token-c0ffee";

/** Playlist ids the fixtures hold, each 22 base-62 characters as Spotify's are. */
export const playlistIds = {
	focus: "1AbCdEfGhIjKlMnOpQrStU",
	roadTrip: "2BcDeFgHiJkLmNoPqRsTuV",
	sharedMix: "3CdEfGhIjKlMnOpQrStUvW",
	gym: "5EfGhIjKlMnOpQrStUvWxY",
	/** Answers 403, as a playlist the user only follows does in development mode. */
	forbidden: "6FgHiJkLmNoPqRsTuVwXyZ",
	/** Answers 404, as a deleted playlist does. */
	missing: "7GhIjKlMnOpQrStUvWxYz0",
} as const;

const details: Record<string, string> = {
	[playlistIds.focus]: "playlist-focus.json",
	[playlistIds.roadTrip]: "playlist-roadtrip.json",
};

const items: Record<string, string> = {
	[playlistIds.focus]: "playlist-focus-items.json",
	[playlistIds.roadTrip]: "playlist-roadtrip-items.json",
	[playlistIds.sharedMix]: "playlist-shared-mix-items.json",
};

export interface RecordedRequest {
	method: string;
	/** The path and query string, exactly as received. */
	url: string;
	path: string;
	query: URLSearchParams;
	headers: Headers;
}

/** Answers one request, or `undefined` to fall through to the recorded fixtures. */
export type Route = (request: RecordedRequest) => Response | undefined;

export interface FakeSpotify {
	/** The Web API base, as `createSpotifyPlugin({ apiBase })` takes it. */
	apiBase: string;
	requests: RecordedRequest[];
	stop(): Promise<void>;
}

export async function fixture(name: string): Promise<unknown> {
	return Bun.file(join(fixtures, name)).json();
}

async function errorResponse(status: 401 | 403 | 404 | 429): Promise<Response> {
	const file = {
		401: "error-401.json",
		403: "error-403-user-not-registered.json",
		429: "error-429.json",
	}[status as 401 | 403 | 429];
	const body = file ? await fixture(file) : { error: { status, message: "Resource not found" } };
	return Response.json(body, { status });
}

/**
 * A Spotify paging object over `all`, `pageSize` at a time, whatever `limit` asked for, so a short
 * fixture still spans several pages. `next` is absolute, as Spotify's is.
 */
function page(all: unknown[], request: RecordedRequest, base: string, pageSize: number): Response {
	const offset = Number(request.query.get("offset") ?? 0);
	const limit = Math.min(Number(request.query.get("limit") ?? 20), pageSize);
	const next = new URL(request.path.replace(/^\//, ""), base);
	for (const [key, value] of request.query) next.searchParams.set(key, value);
	next.searchParams.set("offset", String(offset + limit));
	return Response.json({
		items: all.slice(offset, offset + limit),
		limit,
		offset,
		total: all.length,
		next: offset + limit < all.length ? next.href : null,
	});
}

async function listOf(name: string | undefined): Promise<unknown[]> {
	if (!name) return [];
	return ((await fixture(name)) as { items: unknown[] }).items;
}

async function recorded(
	request: RecordedRequest,
	base: string,
	pageSize: number,
): Promise<Response> {
	const { method, path } = request;
	if (method !== "GET") return errorResponse(404);
	if (path === "/me") return Response.json(await fixture("me.json"));
	if (path === "/me/playlists") {
		return page(await listOf("me-playlists.json"), request, base, pageSize);
	}
	if (path === "/me/tracks") return page(await listOf("me-tracks.json"), request, base, pageSize);
	const playlist = /^\/playlists\/([A-Za-z0-9]+)(\/items)?$/.exec(path);
	if (playlist) {
		const [, id = "", itemsPath] = playlist;
		if (id === playlistIds.forbidden) return errorResponse(403);
		if (itemsPath) {
			if (id === playlistIds.missing) return errorResponse(404);
			return page(await listOf(items[id]), request, base, pageSize);
		}
		const file = details[id];
		return file ? Response.json(await fixture(file)) : errorResponse(404);
	}
	return errorResponse(404);
}

/**
 * Starts the fake on a free local port. `routes` are tried in order before the recorded API.
 * Lists page `pageSize` at a time.
 */
export function startFakeSpotify(routes: Route[] = [], pageSize = 2): FakeSpotify {
	const requests: RecordedRequest[] = [];
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(raw) {
			const url = new URL(raw.url);
			const path = url.pathname.replace(/^\/v1/, "");
			const request: RecordedRequest = {
				method: raw.method,
				url: `${url.pathname}${url.search}`,
				path,
				query: url.searchParams,
				headers: raw.headers,
			};
			requests.push(request);
			for (const route of routes) {
				const response = route(request);
				if (response) return response;
			}
			if (raw.headers.get("Authorization") !== `Bearer ${fakeToken}`) return errorResponse(401);
			return recorded(request, `${url.origin}/v1/`, pageSize);
		},
	});
	return {
		apiBase: `${server.url.origin}/v1`,
		requests,
		stop: () => server.stop(true),
	};
}

/** Answers `GET path` (a path or a pattern) with `response`, leaving every other request alone. */
export function on(path: string | RegExp, response: () => Response): Route {
	return (request) =>
		request.method === "GET" &&
		(typeof path === "string" ? request.path === path : path.test(request.path))
			? response()
			: undefined;
}

/** Answers `path` with `response` the first `times` it is asked, then falls through. */
export function times(count: number, path: string | RegExp, response: () => Response): Route {
	let left = count;
	const route = on(path, response);
	return (request) => {
		if (left <= 0) return undefined;
		const answered = route(request);
		if (answered) left -= 1;
		return answered;
	};
}

/** Spotify's rate-limit answer, asking to wait `seconds`. */
export function rateLimited(seconds: number): Response {
	return Response.json(
		{ error: { status: 429, message: "API rate limit exceeded" } },
		{ status: 429, headers: { "Retry-After": String(seconds) } },
	);
}

/** A URL nothing listens on: the fake, started and stopped. */
export async function unreachableApiBase(): Promise<string> {
	const fake = startFakeSpotify();
	await fake.stop();
	return fake.apiBase;
}
