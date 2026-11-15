// An in-process Plex Media Server that replays `fixtures/` and records every request it receives.
// Code, so it lives outside `test/fixtures`, where the type-check would not see it.
import { join } from "node:path";

const fixtures = join(import.meta.dir, "fixtures");

/** The token the fake accepts; any other is refused with Plex's 401. */
export const fakeToken = "fake-plex-token-c0ffee";

export const machineIdentifier = "3f1a2b4c5d6e7f8091a2b3c4d5e6f708192a3b4c";

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
	stop(): Promise<void>;
}

export async function fixture(name: string): Promise<unknown> {
	return Bun.file(join(fixtures, name)).json();
}

interface PlexTrack {
	ratingKey: string;
	title: string;
	librarySectionID: number;
}

async function tracks(): Promise<PlexTrack[]> {
	const body = (await fixture("library-section-tracks.json")) as {
		MediaContainer: { Metadata: PlexTrack[] };
	};
	return body.MediaContainer.Metadata;
}

function container(metadata: unknown[]): Response {
	return Response.json({ MediaContainer: { size: metadata.length, Metadata: metadata } });
}

async function fixtureResponse(name: string): Promise<Response> {
	return Response.json(await fixture(name));
}

/** The recorded server: one music library, the playlists in `playlists.json`. */
async function recorded(request: RecordedRequest): Promise<Response> {
	const { method, path, query } = request;
	if (method === "GET" && path === "/") return fixtureResponse("server-root.json");
	if (method === "GET" && path === "/library/sections") {
		return fixtureResponse("library-sections.json");
	}
	const section = /^\/library\/sections\/(\d+)\/all$/.exec(path);
	if (method === "GET" && section && query.get("type") === "10") {
		const title = query.get("title")?.toLowerCase() ?? "";
		const size = Number(query.get("X-Plex-Container-Size") ?? Number.POSITIVE_INFINITY);
		const found = (await tracks()).filter(
			(track) =>
				String(track.librarySectionID) === section[1] && track.title.toLowerCase().includes(title),
		);
		return container(found.slice(0, size));
	}
	const metadata = /^\/library\/metadata\/(\d+)$/.exec(path);
	if (method === "GET" && metadata) {
		const track = (await tracks()).find((candidate) => candidate.ratingKey === metadata[1]);
		return track ? container([track]) : new Response("Not Found", { status: 404 });
	}
	if (method === "GET" && path === "/playlists") return fixtureResponse("playlists.json");
	if (method === "GET" && path === "/playlists/7001/items") {
		return fixtureResponse("playlist-items.json");
	}
	if (method === "POST" && path === "/playlists") return fixtureResponse("playlist-created.json");
	if (method === "PUT" && /^\/playlists\/\d+\/items$/.test(path)) {
		return fixtureResponse("playlist-items-added.json");
	}
	if (method === "DELETE" && /^\/playlists\/\d+\/items\/\d+$/.test(path)) {
		return new Response(null, { status: 200 });
	}
	return new Response("Not Found", { status: 404 });
}

/** Starts the fake on a free local port. `routes` are tried in order before the recorded server. */
export function startFakePlex(routes: Route[] = []): FakePlex {
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
			return recorded(request);
		},
	});
	return { url: server.url.href, requests, stop: () => server.stop(true) };
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
