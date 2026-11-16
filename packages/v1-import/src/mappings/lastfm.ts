import type { JsonObject } from "@ultrasonics/db";
import type { Mapping } from "../mapping.ts";

/** What v2's Last.fm input reads when `limit` is absent, and the most it reads (spec #185). */
const limit = { default: 50, max: 1_000 } as const;

/** v1's runtime default for a blank playlist title, kept so an imported applet names it the same. */
export const V1_PLAYLIST_TITLE = "Last.fm Music";

const selects: Record<string, string> = {
	"Loved Tracks": "loved",
	"Top Tracks": "top",
	"Recent Tracks": "recent",
};

const periods: Record<string, string> = {
	Overall: "overall",
	"7 Days": "7day",
	"1 Month": "1month",
	"3 Months": "3month",
	"6 Months": "6month",
	"12 Months": "12month",
};

const endings: Record<string, string> = {
	Now: "now",
	"7 Days Ago": "7d",
	"1 Month Ago": "1m",
	"3 Months Ago": "3m",
	"6 Months Ago": "6m",
	"1 Year Ago": "1y",
	"2 Years Ago": "2y",
};

const spans: Record<string, string> = {
	"1 Day": "1d",
	"7 Days": "7d",
	"1 Month": "1m",
	"3 Months": "3m",
	"6 Months": "6m",
	"1 Year": "1y",
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The report's notes, shared with the tests. */
export const notes = {
	blankLimit: `Its Last.fm song limit was blank, so it reads ${limit.default}.`,
	notWholeNumber: (written: string) =>
		`Its Last.fm song limit ("${written}") wasn't a whole number from 1 up, so it reads ${limit.default}.`,
	aboveMost: (value: number) =>
		`Its Last.fm song limit, ${value}, is above v2's most, so it reads ${limit.max}.`,
	blankChoice: (field: string) => `Its Last.fm ${field} was blank, so the default is used.`,
	unknownChoice: (field: string) =>
		`Its Last.fm ${field} wasn't one v2 knows, so the default is used.`,
	noUsername:
		"v1 had no Last.fm username. Enter the user to read in this applet before enabling it.",
} as const;

/** Some of an applet's v2 settings, and the report note they need, if any. */
interface Part {
	settings: JsonObject;
	note?: string;
}

/**
 * v1's free-text limit as v2's number: a whole number is kept, capped at v2's most, and anything
 * else is left out so v2's default applies (spec #185, closing v1's `int('')` crash).
 */
function limitOf(raw: unknown): Part {
	const written = text(raw);
	if (written === "") return { settings: {}, note: notes.blankLimit };
	if (!/^\d+$/.test(written) || Number(written) < 1) {
		return { settings: {}, note: notes.notWholeNumber(written) };
	}
	const value = Number(written);
	if (value > limit.max) return { settings: { limit: limit.max }, note: notes.aboveMost(value) };
	return { settings: { limit: value } };
}

/** One of v1's labels as v2's value, or a note that the default stands in for it. */
function choice(table: Record<string, string>, raw: unknown, field: string): Part {
	const written = text(raw);
	const value = table[written];
	if (value !== undefined) return { settings: { [field]: value } };
	const note = written === "" ? notes.blankChoice(field) : notes.unknownChoice(field);
	return { settings: {}, note };
}

/** v1's `lastfm` 0.1 input as v2's (spec #185, "v1 import mapping"). */
export const lastfmMapping: Mapping = {
	plugin: "lastfm",
	accepts: (name, version) => name === "lastfm" && version === "0.1",
	setup: { apiKey: "Last.fm" },
	instance(component, v1, v1Persistent: JsonObject | undefined) {
		if (component !== "inputs") throw new Error(`v1's Last.fm plugin has no ${component}.`);
		const select = selects[text(v1.select)];
		if (!select) throw new Error("Its Last.fm selection isn't loved, top or recent tracks.");
		// v1 kept one username per install; v2 asks per applet (spec #185, decision 1).
		const username = text(v1Persistent?.username);
		const parts: Part[] = [
			{ settings: {}, ...(username === "" ? { note: notes.noUsername } : {}) },
			limitOf(v1.limit),
			...(select === "top" ? [choice(periods, v1.period, "period")] : []),
			...(select === "recent"
				? [
						choice(endings, v1["period-end"], "ending"),
						choice(spans, v1["period-duration"], "span"),
					]
				: []),
		];
		const settings: JsonObject = {
			select,
			username,
			name: text(v1.playlist_title) || V1_PLAYLIST_TITLE,
			...Object.assign({}, ...parts.map((part) => part.settings)),
		};
		return { settings, notes: parts.flatMap((part) => part.note ?? []) };
	},
};
