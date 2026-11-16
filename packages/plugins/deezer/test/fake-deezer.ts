// An in-process Deezer API that replays `fixtures/` (recorded live on 16 November 2026) and records
// every request it receives. Code, so it lives outside `test/fixtures`, where the type-check would
// not see it.
import { join } from "node:path";

const fixtures = join(import.meta.dir, "fixtures");

/** Playlist ids the fake answers for. */
export const playlistIds = {
	/** "Top 1000 Greatest Rock Songs of All Time": 1,000 tracks, so ten pages at `limit=100`. */
	rock: "8763353462",
	/** "80s HITS - 100 Greatest Songs of the 1980s": 100 tracks, one page. */
	eighties: "11798808421",
	/** Answers code 800, as a deleted playlist did live. */
	missing: "1",
	/** Answers `OAuthException`, as the plugin assumes a private playlist would without a token. */
	private: "2",
} as const;

const recordings: Record<string, { details: string; tracks: string }> = {
	[playlistIds.rock]: { details: "playlist-rock.json", tracks: "playlist-rock-tracks.json" },
	[playlistIds.eighties]: { details: "playlist-80s.json", tracks: "playlist-80s-tracks.json" },
};

export interface RecordedRequest {
	method: string;
	path: string;
	query: URLSearchParams;
}

/** Answers one request, or `undefined` to fall through to the recorded fixtures. */
export type Route = (
	request: RecordedRequest,
) => Promise<Response | undefined> | Response | undefined;

export interface FakeDeezer {
	/** The API base, as `createDeezerPlugin({ apiBase })` takes it. */
	apiBase: string;
	requests: RecordedRequest[];
	stop(): Promise<void>;
}

export async function fixture(name: string): Promise<unknown> {
	return Bun.file(join(fixtures, name)).json();
}

/** Deezer reports its errors inside a 200 body. */
const deezerError = async (name: string) => Response.json(await fixture(name));
export const quotaExceeded = () => deezerError("error-4-quota.json");

/** One page of `all`, as Deezer pages by `index` and `limit`, its `next` absent on the last. */
function page(all: unknown[], request: RecordedRequest, origin: string): Response {
	const index = Number(request.query.get("index") ?? 0);
	const limit = Number(request.query.get("limit") ?? 25);
	const next = new URL(request.path, origin);
	next.searchParams.set("limit", String(limit));
	next.searchParams.set("index", String(index + limit));
	return Response.json({
		data: all.slice(index, index + limit),
		checksum: "0",
		total: all.length,
		...(index + limit < all.length ? { next: next.href } : {}),
	});
}

async function recorded(request: RecordedRequest, origin: string): Promise<Response> {
	const playlist = /^\/playlist\/(\d+)(\/tracks)?$/.exec(request.path);
	if (request.method !== "GET" || !playlist) return deezerError("error-800-no-data.json");
	const [, id = "", tracks] = playlist;
	if (id === playlistIds.private) return deezerError("error-oauth.json");
	const recording = recordings[id];
	if (!recording) return deezerError("error-800-no-data.json");
	if (!tracks) return Response.json(await fixture(recording.details));
	const { data } = (await fixture(recording.tracks)) as { data: unknown[] };
	return page(data, request, origin);
}

/** Starts the fake on a free local port. `routes` are tried in order before the recordings. */
export function startFakeDeezer(routes: Route[] = []): FakeDeezer {
	const requests: RecordedRequest[] = [];
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(raw) {
			const url = new URL(raw.url);
			const request: RecordedRequest = {
				method: raw.method,
				path: url.pathname,
				query: url.searchParams,
			};
			requests.push(request);
			for (const route of routes) {
				const response = await route(request);
				if (response) return response;
			}
			return recorded(request, url.origin);
		},
	});
	return { apiBase: server.url.origin, requests, stop: () => server.stop(true) };
}

/** Answers `GET path` with `response` the first `count` times it is asked, then falls through. */
export function times(
	count: number,
	path: string,
	response: () => Promise<Response> | Response,
): Route {
	let left = count;
	return (request) => {
		if (left <= 0 || request.method !== "GET" || request.path !== path) return undefined;
		left -= 1;
		return response();
	};
}

/** A URL nothing listens on: the fake, started and stopped. */
export async function unreachableApiBase(): Promise<string> {
	const fake = startFakeDeezer();
	await fake.stop();
	return fake.apiBase;
}
