import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MatchCase, type MatchCaseInput } from "./match-case.ts";
import { collectServiceTier, loadServiceTier, type ServiceTier } from "./service-tier.ts";

// Fakes written by hand in each API's shape; never copied from a real response.
const spotifyTracks: Record<string, object> = {
	GBAAA0000001: {
		name: "Strobe - Remastered 2020",
		artists: [{ name: "deadmau5" }],
		album: { name: "For Lack of a Better Name", release_date: "2009-09-22" },
		duration_ms: 637000,
		explicit: false,
		external_ids: { isrc: "gbaaa0000001" },
	},
	GBAAA0000003: {
		name: "Home",
		artists: [{ name: "Edward Sharpe" }, { name: "The Magnetic Zeros" }],
		album: { name: "Up from Below", release_date: "2009" },
		duration_ms: 303000,
		explicit: false,
		external_ids: { isrc: "GBAAA0000003" },
	},
	GBAAA0000004: {
		name: "Home",
		artists: [{ name: "Daughtry" }],
		album: { name: "Daughtry", release_date: "2006-11-21" },
		duration_ms: 254000,
		explicit: false,
		external_ids: { isrc: "GBAAA0000004" },
	},
	GBAAA0000005: {
		name: "Only Here",
		artists: [{ name: "Nobody" }],
		album: { name: "Nowhere", release_date: "2001" },
		duration_ms: 180000,
		external_ids: { isrc: "GBAAA0000005" },
	},
};

const deezerTracks: Record<string, object> = {
	GBAAA0000001: {
		title: "Strobe",
		artist: { name: "deadmau5" },
		contributors: [{ name: "deadmau5" }],
		album: { title: "For Lack of a Better Name" },
		release_date: "2009-09-22",
		duration: 637,
		explicit_lyrics: false,
		isrc: "GBAAA0000001",
	},
	GBAAA0000003: {
		title: "Home",
		artist: { name: "Edward Sharpe & The Magnetic Zeros" },
		album: { title: "Up from Below" },
		release_date: "2009-07-07",
		duration: 303,
		explicit_lyrics: false,
		isrc: "GBAAA0000003",
	},
	GBAAA0000004: {
		title: "Home",
		artist: { name: "Daughtry" },
		album: { title: "Daughtry" },
		release_date: "2006-11-21",
		duration: 254,
		explicit_lyrics: false,
		isrc: "GBAAA0000004",
	},
};

function fakeFetch(calls: string[] = []): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = new URL(String(input));
		calls.push(url.hostname);
		if (url.hostname === "accounts.spotify.com") {
			return Response.json({ access_token: "token", token_type: "Bearer", expires_in: 3600 });
		}
		if (url.hostname === "api.spotify.com") {
			const isrc = url.searchParams.get("q")?.replace("isrc:", "") ?? "";
			const track = spotifyTracks[isrc];
			return Response.json({ tracks: { items: track ? [track] : [] } });
		}
		const isrc = url.pathname.replace("/track/isrc:", "");
		const track = deezerTracks[isrc];
		return Response.json(track ?? { error: { type: "DataException", code: 800 } });
	}) as typeof fetch;
}

const recording = "dfa9ec77-2eb1-4149-8427-739f5aa09f4b";
const other = "390392e5-3a02-496d-ae64-36ace73cae79";

function mbCase(
	category: MatchCaseInput["category"],
	isrcA: string,
	isrcB: string,
): MatchCaseInput {
	return {
		a: { title: "x", artists: ["y"], isrc: isrcA },
		b: { title: "x", artists: ["y"], isrc: isrcB },
		label: category === "plain" ? "match" : "no-match",
		category,
		provenance: {
			source: "musicbrainz",
			a: { isrc: isrcA, recording },
			b: { isrc: isrcB, recording: category === "plain" ? recording : other },
		},
	};
}

const positive = MatchCase.parse(mbCase("plain", "GBAAA0000001", "GBAAA0000001"));
const sameTitle = MatchCase.parse(mbCase("same-title", "GBAAA0000003", "GBAAA0000004"));
const missingOnDeezer = MatchCase.parse(mbCase("plain", "GBAAA0000005", "GBAAA0000005"));
const keys = { SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "secret" };

describe("collectServiceTier", () => {
	test("maps each side to a song dict with the SDK's normalisers", async () => {
		const tier = await collectServiceTier([positive], keys, fakeFetch());
		const sides = [tier.cases[0]?.a, tier.cases[0]?.b];
		expect(sides).toContainEqual({
			title: "Strobe - Remastered 2020",
			artists: ["deadmau5"],
			album: "For Lack of a Better Name",
			date: "2009-09-22",
			isrc: "GBAAA0000001",
			durationMs: 637000,
			explicit: false,
			id: {},
		});
		expect(sides).toContainEqual({
			title: "Strobe",
			artists: ["deadmau5"],
			album: "For Lack of a Better Name",
			date: "2009-09-22",
			isrc: "GBAAA0000001",
			durationMs: 637000,
			explicit: false,
			id: {},
		});
	});

	test("pairs every case across two services", async () => {
		const tier = await collectServiceTier([positive, sameTitle], keys, fakeFetch());
		for (const c of tier.cases) {
			if (c.provenance.source !== "service") throw new Error("expected service provenance");
			expect(c.provenance.a.service).not.toBe(c.provenance.b.service);
		}
		expect(tier.cases).toHaveLength(2);
	});

	test("carries a trap's label over and gives every case a valid schema", async () => {
		const tier = await collectServiceTier([sameTitle], keys, fakeFetch());
		expect(tier.cases.map((c) => [c.category, c.label])).toEqual([["same-title", "no-match"]]);
		for (const c of tier.cases) expect(MatchCase.safeParse(c).success).toBe(true);
	});

	test("reports a positive whose sides disagree on a remaster marker as a remaster", async () => {
		const tier = await collectServiceTier([positive], keys, fakeFetch());
		expect(tier.cases[0]?.category).toBe("remaster");
	});

	test("drops and counts a case missing on one service", async () => {
		const tier = await collectServiceTier([positive, missingOnDeezer], keys, fakeFetch());
		expect(tier.cases).toHaveLength(1);
		expect(tier.dropped).toBe(1);
	});

	test("skips a service with no keys and names it", async () => {
		const calls: string[] = [];
		const tier = await collectServiceTier([positive], {}, fakeFetch(calls));
		expect(tier.skipped).toEqual(["spotify"]);
		expect(calls).not.toContain("api.spotify.com");
		expect(tier.cases).toHaveLength(0);
	});
});

describe("loadServiceTier", () => {
	test("reports a missing cache rather than an empty tier", async () => {
		const dir = await mkdtemp(join(tmpdir(), "service-tier-"));
		expect(await loadServiceTier(join(dir, "service-tier.json"))).toEqual({ kind: "missing" });
	});

	test("loads a cache the collector wrote", async () => {
		const dir = await mkdtemp(join(tmpdir(), "service-tier-"));
		const file = join(dir, "service-tier.json");
		const tier: ServiceTier = await collectServiceTier([positive], keys, fakeFetch());
		await writeFile(file, JSON.stringify(tier));
		expect(await loadServiceTier(file)).toEqual({ kind: "loaded", tier });
	});
});
