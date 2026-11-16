// An in-process Last.fm API that serves `fixtures/` (written by hand from the documented shapes; see
// its README) and records every request it receives. Code, so it lives outside `test/fixtures`,
// where the type-check would not see it.
import { join } from "node:path";

const fixtures = join(import.meta.dir, "fixtures");

/** The only key the fake accepts. */
export const fakeApiKey = "0123456789abcdef0123456789abcdef";

/** The only user the fake knows; any other answers error 6. */
export const fakeUser = "rj";

export interface RecordedRequest {
	method: string;
	query: URLSearchParams;
	headers: Headers;
}

/** Answers one request, or `undefined` to fall through to the fixtures. */
export type Route = (
	request: RecordedRequest,
) => Promise<Response | undefined> | Response | undefined;

export interface FakeLastfm {
	/** The API root, as `createLastfmPlugin({ apiBase })` takes it. */
	apiBase: string;
	requests: RecordedRequest[];
	stop(): Promise<void>;
}

export async function fixture<T = unknown>(name: string): Promise<T> {
	return Bun.file(join(fixtures, name)).json();
}

/** Last.fm's error body, with the status it is assumed to come with (fixtures README). */
export const lastfmError = async (name: string, status: number) =>
	Response.json(await fixture(name), { status });
export const rateLimited = () => lastfmError("error-29-rate-limit.json", 429);
export const operationFailed = () => lastfmError("error-8-operation-failed.json", 500);

/** Each user method's fixture, and the key its answer sits under. */
const userMethods: Record<string, { file: string; wrapper: string }> = {
	"user.getlovedtracks": { file: "loved-tracks.json", wrapper: "lovedtracks" },
	"user.gettoptracks": { file: "top-tracks.json", wrapper: "toptracks" },
	"user.getrecenttracks": { file: "recent-tracks.json", wrapper: "recenttracks" },
};

/** Lists the fake serves in place of a fixture's tracks, by lower-cased method name. */
export type TrackLists = Partial<Record<string, unknown[]>>;

/**
 * One page of `tracks`, as Last.fm pages by `limit` and `page`. A now-playing track rides on top of
 * page 1, beyond `limit`, as Last.fm's recent tracks do.
 */
async function page(method: string, tracks: unknown[], query: URLSearchParams): Promise<Response> {
	const { file, wrapper } = userMethods[method] as { file: string; wrapper: string };
	const body = await fixture<Record<string, { "@attr": Record<string, string> }>>(file);
	const limit = Number(query.get("limit") ?? 50);
	const pageNumber = Number(query.get("page") ?? 1);
	const nowPlaying = tracks.filter(isNowPlaying);
	const scrobbled = tracks.filter((track) => !isNowPlaying(track));
	const start = (pageNumber - 1) * limit;
	const items = [...(pageNumber === 1 ? nowPlaying : []), ...scrobbled.slice(start, start + limit)];
	const attr = body[wrapper]?.["@attr"] ?? {};
	return Response.json({
		[wrapper]: {
			track: items,
			"@attr": {
				...attr,
				page: String(pageNumber),
				perPage: String(limit),
				totalPages: String(Math.max(1, Math.ceil(scrobbled.length / limit))),
				total: String(scrobbled.length),
			},
		},
	});
}

function isNowPlaying(track: unknown): boolean {
	const attr = (track as { "@attr"?: { nowplaying?: string } })["@attr"];
	return attr?.nowplaying === "true";
}

async function answer(request: RecordedRequest, lists: TrackLists): Promise<Response> {
	const { query } = request;
	if (query.get("format") !== "json") return new Response('<lfm status="failed"/>');
	const key = query.get("api_key");
	if (key !== fakeApiKey) return lastfmError("error-10-invalid-key.json", 403);
	if (request.method === "chart.gettopartists") {
		return Response.json(await fixture("chart-top-artists.json"));
	}
	const user = userMethods[request.method];
	if (!user) return Response.json({ error: 3, message: "Invalid Method" }, { status: 400 });
	if (query.get("user") !== fakeUser) return lastfmError("error-6-user-not-found.json", 404);
	const tracks =
		lists[request.method] ??
		(await fixture<Record<string, { track: unknown[] }>>(user.file))[user.wrapper]?.track ??
		[];
	return page(request.method, tracks, query);
}

/**
 * Starts the fake on a free local port. `routes` are tried in order before the fixtures, and
 * `lists` replace a method's fixture tracks.
 */
export function startFakeLastfm(
	options: { routes?: Route[]; lists?: TrackLists; port?: number } = {},
): FakeLastfm {
	const requests: RecordedRequest[] = [];
	const server = Bun.serve({
		port: options.port ?? 0,
		hostname: "127.0.0.1",
		async fetch(raw) {
			const url = new URL(raw.url);
			const request: RecordedRequest = {
				method: (url.searchParams.get("method") ?? "").toLowerCase(),
				query: url.searchParams,
				headers: raw.headers,
			};
			requests.push(request);
			for (const route of options.routes ?? []) {
				const response = await route(request);
				if (response) return response;
			}
			return answer(request, options.lists ?? {});
		},
	});
	return {
		apiBase: `${server.url.origin}/2.0/`,
		requests,
		stop: () => server.stop(true),
	};
}

/** Answers `method` with `response` the first `count` times it is asked, then falls through. */
export function times(
	count: number,
	method: string,
	response: () => Promise<Response> | Response,
): Route {
	let left = count;
	return (request) => {
		if (left <= 0 || request.method !== method.toLowerCase()) return undefined;
		left -= 1;
		return response();
	};
}

/** `count` distinct tracks, numbered, shaped like the fixture's first scrobbled one. */
export async function manyTracks(file: string, wrapper: string, count: number): Promise<unknown[]> {
	const body = await fixture<Record<string, { track: Record<string, unknown>[] }>>(file);
	const template = body[wrapper]?.track.find((track) => !isNowPlaying(track)) ?? {};
	return Array.from({ length: count }, (_, index) => ({ ...template, name: `Track ${index + 1}` }));
}

/** A URL nothing listens on: the fake, started and stopped. */
export async function unreachableApiBase(): Promise<string> {
	const fake = startFakeLastfm();
	await fake.stop();
	return fake.apiBase;
}
