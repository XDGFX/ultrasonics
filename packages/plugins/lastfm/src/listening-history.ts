import type { Log, PlaylistInput, SongInput } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import type { InputSettings } from "./input-settings.ts";
import type { LastfmClient } from "./lastfm-client.ts";
import { isNowPlaying, songOf } from "./track.ts";

/** The documented most for `user.getRecentTracks`; the other two state none (spec #185). */
export const pageSize = 200;

const day = 86_400;
/** v1's figures: a month is a twelfth of a 365.25-day year. */
const year = 365.25 * day;
const month = year / 12;

/** Each window setting in seconds. */
const seconds = {
	now: 0,
	"1d": day,
	"7d": 7 * day,
	"1m": month,
	"3m": 3 * month,
	"6m": 6 * month,
	"1y": year,
	"2y": 2 * year,
} as const;

/** What each `select` calls, and under which key its answer sits. */
const methods = {
	loved: { method: "user.getLovedTracks", wrapper: "lovedtracks" },
	top: { method: "user.getTopTracks", wrapper: "toptracks" },
	recent: { method: "user.getRecentTracks", wrapper: "recenttracks" },
} as const;

const Page = z.object({
	track: z.unknown().optional(),
	"@attr": z.object({ totalPages: z.union([z.string(), z.number()]) }),
});

/** One page: a lone track arrives as an object, not a one-item array, and none as `[]` or absent. */
const pageOf = (wrapper: string) =>
	z.object({ [wrapper]: Page }).transform((body) => {
		const { track, "@attr": attr } = body[wrapper] as z.output<typeof Page>;
		const tracks = track === undefined ? [] : Array.isArray(track) ? track : [track];
		return { tracks, totalPages: Number(attr.totalPages) || 0 };
	});

/** The `from` and `to` of a `recent` window, in Unix seconds, against `nowMs`. */
export function recentWindow(
	settings: Extract<InputSettings, { select: "recent" }>,
	nowMs: number,
): { from: number; to: number } {
	const to = Math.floor(nowMs / 1000 - seconds[settings.ending]);
	return { from: Math.floor(to - seconds[settings.span]), to };
}

function paramsOf(settings: InputSettings, nowMs: number): Record<string, string> {
	const params: Record<string, string> = { user: settings.username };
	if (settings.select === "top") params.period = settings.period;
	if (settings.select === "recent") {
		const { from, to } = recentWindow(settings, nowMs);
		params.from = String(from);
		params.to = String(to);
	}
	return params;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Reads the user's history as one playlist (spec #185, "Reading"). */
export async function readHistory(
	client: LastfmClient,
	settings: InputSettings,
	nowMs: number,
	log: Log,
): Promise<{ playlists: PlaylistInput[] }> {
	const { method, wrapper } = methods[settings.select];
	const schema = pageOf(wrapper);
	const params = paramsOf(settings, nowMs);
	const dropRepeats = settings.select === "recent";
	const seen = new Set<string>();
	const songs: SongInput[] = [];
	let repeats = 0;
	let untitled = 0;

	for (let page = 1; songs.length < settings.limit; page += 1) {
		const { tracks, totalPages } = await client.call(schema, method, {
			...params,
			limit: String(pageSize),
			page: String(page),
		});
		for (const raw of tracks) {
			if (isNowPlaying(raw)) continue;
			const song = songOf(raw);
			if (!song) {
				untitled += 1;
				continue;
			}
			if (dropRepeats) {
				// Newest first, so the first sighting is the latest scrobble (spec #185, decision 2).
				const key = JSON.stringify([
					song.artists.join(", ").toLowerCase(),
					song.title.toLowerCase(),
				]);
				if (seen.has(key)) {
					repeats += 1;
					continue;
				}
				seen.add(key);
			}
			songs.push(song);
			if (songs.length >= settings.limit) break;
		}
		if (page >= totalPages) break;
	}

	if (untitled > 0) log.warn(`Skipped ${plural(untitled, "track", "tracks")} without a title`);
	log.info(
		`Read ${plural(songs.length, "song", "songs")} from ${method} for ${settings.username}; dropped ${plural(repeats, "repeat", "repeats")}`,
	);
	return { playlists: [{ name: settings.name, songs }] };
}
