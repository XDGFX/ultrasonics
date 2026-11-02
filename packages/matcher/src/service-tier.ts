import { readFile } from "node:fs/promises";
import { normaliseDate, normaliseIsrc, Song } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import {
	type Category,
	isPositive,
	MatchCase,
	oneSideRemastered,
	ServiceName,
} from "./match-case.ts";

/** The held-out tier as the collector caches it; never committed or pushed (spec #117). */
export const ServiceTier = z.object({
	cases: z.array(MatchCase),
	dropped: z.number().int().nonnegative(),
	skipped: z.array(ServiceName),
});
export type ServiceTier = z.output<typeof ServiceTier>;

/** A request a service refused or failed, which would otherwise read as a missing track. */
export class ServiceRequestError extends Error {
	constructor(service: ServiceName, status: number) {
		super(`${service} answered ${status}; stopping rather than counting cases as missing.`);
		this.name = "ServiceRequestError";
	}
}

type Env = Record<string, string | undefined>;

export interface CollectOptions {
	/** A pause after each case, to stay inside the services' rate limits. */
	pauseMs?: number;
	now?: () => number;
}

interface Service {
	name: ServiceName;
	find(isrc: string): Promise<Song | undefined>;
}

const SpotifyTrack = z.object({
	name: z.string(),
	artists: z.array(z.object({ name: z.string() })),
	album: z.object({ name: z.string(), release_date: z.string().nullish() }),
	duration_ms: z.number().nullish(),
	explicit: z.boolean().nullish(),
	external_ids: z.object({ isrc: z.string().nullish() }).nullish(),
});

const SpotifySearch = z.object({ tracks: z.object({ items: z.array(SpotifyTrack) }) });

const SpotifyToken = z.object({ access_token: z.string(), expires_in: z.number() });

const DeezerTrack = z.object({
	title: z.string(),
	artist: z.object({ name: z.string() }),
	contributors: z.array(z.object({ name: z.string() })).nullish(),
	album: z.object({ title: z.string() }).nullish(),
	release_date: z.string().nullish(),
	duration: z.number().nullish(),
	explicit_lyrics: z.boolean().nullish(),
	isrc: z.string().nullish(),
});

/** Parses through the SDK's `Song`; a case's songs carry no `id`, so none is set. */
function song(fields: z.input<typeof Song>): Song | undefined {
	return Song.safeParse(fields).data;
}

async function json(service: ServiceName, response: Response): Promise<unknown> {
	if (!response.ok) throw new ServiceRequestError(service, response.status);
	return response.json();
}

function spotify(env: Env, fetcher: typeof fetch, now: () => number): Service | undefined {
	const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = env;
	if (!id || !secret) return undefined;
	let token: { value: string; expiresAt: number } | undefined;
	const bearer = async () => {
		if (!token || now() >= token.expiresAt) {
			const response = await fetcher("https://accounts.spotify.com/api/token", {
				method: "POST",
				headers: {
					Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: "grant_type=client_credentials",
			});
			const granted = SpotifyToken.parse(await json("spotify", response));
			token = { value: granted.access_token, expiresAt: now() + granted.expires_in * 1000 };
		}
		return token.value;
	};
	return {
		name: "spotify",
		async find(isrc) {
			const url = new URL("https://api.spotify.com/v1/search");
			url.search = new URLSearchParams({ q: `isrc:${isrc}`, type: "track", limit: "1" }).toString();
			const headers = { Authorization: `Bearer ${await bearer()}` };
			const body = await json("spotify", await fetcher(url, { headers }));
			const track = SpotifySearch.safeParse(body).data?.tracks.items[0];
			return (
				track &&
				song({
					title: track.name,
					artists: track.artists.map((a) => a.name),
					album: track.album.name,
					date: track.album.release_date ? normaliseDate(track.album.release_date) : undefined,
					isrc: track.external_ids?.isrc ? normaliseIsrc(track.external_ids.isrc) : undefined,
					durationMs: track.duration_ms,
					explicit: track.explicit,
				})
			);
		},
	};
}

function deezer(fetcher: typeof fetch): Service {
	return {
		name: "deezer",
		async find(isrc) {
			// Deezer answers a missing track with 200 and an error body, which fails the parse.
			const body = await json("deezer", await fetcher(`https://api.deezer.com/track/isrc:${isrc}`));
			const track = DeezerTrack.safeParse(body).data;
			return (
				track &&
				song({
					title: track.title,
					artists: track.contributors?.map((c) => c.name) ?? [track.artist.name],
					album: track.album?.title,
					date: track.release_date ? normaliseDate(track.release_date) : undefined,
					isrc: track.isrc ? normaliseIsrc(track.isrc) : undefined,
					durationMs: track.duration ? track.duration * 1000 : undefined,
					explicit: track.explicit_lyrics,
				})
			);
		},
	};
}

/** Labels carry over; a positive's category comes from what the two services actually show. */
function categoryOf(original: Category, a: Song, b: Song): Category {
	if (!isPositive(original)) return original;
	if (oneSideRemastered(a, b)) return "remaster";
	if (a.explicit !== undefined && b.explicit !== undefined && a.explicit !== b.explicit)
		return "clean-explicit";
	return "plain";
}

/**
 * Fetches each MusicBrainz case's sides by ISRC, one side from each of two services, so a
 * positive is never a service's track against itself.
 */
export async function collectServiceTier(
	cases: readonly MatchCase[],
	env: Env,
	fetcher: typeof fetch,
	{ pauseMs = 0, now = Date.now }: CollectOptions = {},
): Promise<ServiceTier> {
	const keyed = spotify(env, fetcher, now);
	// With one service left there is no cross-service pair to make.
	if (!keyed) return { cases: [], dropped: 0, skipped: ["spotify"] };
	const services = [keyed, deezer(fetcher)];
	const tier: ServiceTier = { cases: [], dropped: 0, skipped: [] };

	const sources = cases.flatMap((c) =>
		c.provenance.source === "musicbrainz" ? [{ ...c, provenance: c.provenance }] : [],
	);
	for (const [index, c] of sources.entries()) {
		const { a: sideA, b: sideB } = c.provenance;
		const serviceA = services[index % services.length] as Service;
		const serviceB = services[(index + 1) % services.length] as Service;
		const a = sideA.isrc ? await serviceA.find(sideA.isrc) : undefined;
		const b = sideB.isrc && a ? await serviceB.find(sideB.isrc) : undefined;
		if (pauseMs) await Bun.sleep(pauseMs);
		if (!a?.isrc || !b?.isrc) {
			tier.dropped++;
			continue;
		}
		tier.cases.push(
			MatchCase.parse({
				a,
				b,
				label: c.label,
				category: categoryOf(c.category, a, b),
				provenance: {
					source: "service",
					a: { service: serviceA.name, isrc: a.isrc },
					b: { service: serviceB.name, isrc: b.isrc },
				},
			}),
		);
	}
	return tier;
}

export type LoadedServiceTier = { kind: "missing" } | { kind: "loaded"; tier: ServiceTier };

/** A missing cache is its own result, so a skipped tier is never mistaken for a pass. */
export async function loadServiceTier(path: string): Promise<LoadedServiceTier> {
	const text = await readFile(path, "utf8").catch(() => undefined);
	if (text === undefined) return { kind: "missing" };
	return { kind: "loaded", tier: ServiceTier.parse(JSON.parse(text)) };
}
