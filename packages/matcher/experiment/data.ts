/**
 * Experiment for #132, not shipped: the CC0 tier, its seeded tune/evaluation split, and the two
 * sets the spec says the tier should gain, built here from MusicBrainz facts already fetched by
 * `fetch-recordings.ts`: positives with two ISRCs, and candidate sets for the ranking figure.
 */
import type { Song } from "@ultrasonics/plugin-sdk";
import { z } from "zod";
import { MatchCase } from "../src/match-case.ts";
import { normalise } from "../src/normalise.ts";
import handWrittenJson from "../test/fixtures/match-dataset/hand-written.json";
import musicbrainzJson from "../test/fixtures/match-dataset/musicbrainz.json";
import type { RecordingFacts } from "./fetch-recordings.ts";

export const seed = "132";
/** The share of MusicBrainz cases used for fitting weights and thresholds; the rest is held out. */
export const tuneShare = 0.4;

const sha1 = (text: string) => new Bun.CryptoHasher("sha1").update(text).digest("hex");
const draw = (key: string) => Number.parseInt(sha1(`${seed}|${key}`).slice(0, 8), 16) / 2 ** 32;

export const musicbrainz = z.array(MatchCase).parse(musicbrainzJson);
export const handWritten = z.array(MatchCase).parse(handWrittenJson);
/** Written by `fetch-recordings.ts` and git-ignored, so it is read at run time. */ export const recordings: Record<
	string,
	RecordingFacts
> = await Bun.file(new URL("./recordings.json", import.meta.url)).json();

const pairKey = (c: MatchCase) =>
	c.provenance.source === "musicbrainz"
		? `${c.provenance.a.recording}|${c.provenance.b.recording}|${c.category}`
		: JSON.stringify([c.a, c.b]);

/** Fixed by the seed: a case is in the tuning split when its draw falls under `tuneShare`. */
export const inTune = (c: MatchCase) =>
	c.provenance.source === "musicbrainz" && draw(pairKey(c)) < tuneShare;

export const tune = musicbrainz.filter(inTune);
/** The held-out split: the rest of the MusicBrainz cases plus every hand-written one. */
export const evaluation = [...musicbrainz.filter((c) => !inTune(c)), ...handWritten];
/** The whole tier, as the shipped harness measures it. */
export const full = [...musicbrainz, ...handWritten];

/**
 * Each positive whose recording carries more than one ISRC, rebuilt so its `b` side carries one
 * of the others. These are one recording under two ISRCs, so an ISRC-visible figure can't be
 * passed by rejecting every ISRC difference.
 */
export function twoIsrcPositives(cases: readonly MatchCase[]): MatchCase[] {
	return cases.flatMap((c) => {
		if (c.label !== "match" || c.provenance.source !== "musicbrainz" || !c.a.isrc) return [];
		const facts = recordings[c.provenance.b.recording];
		const other = facts?.isrcs.filter((isrc) => isrc !== c.a.isrc).sort()[0];
		return other === undefined ? [] : [{ ...c, b: { ...c.b, isrc: other } }];
	});
}

export interface CandidateSet {
	readonly category: string;
	readonly source: Song;
	/** The original first, then the lookalike, before shuffling. */
	readonly candidates: readonly Song[];
	readonly originalIndex: number;
	readonly tune: boolean;
	/** Whether the lookalike shares the source's album title, as an album remix can. */
	readonly lookalikeSharesAlbum: boolean;
	/** Another ISRC MusicBrainz lists for the original recording, when it has one. */
	readonly otherIsrc?: string;
}

/**
 * A ranking case per remix, re-recording, live and edit trap: the source is the trap's original
 * recording on another of its releases, and the candidates are the original as the tier has it
 * and the lookalike, in an order drawn from the seed (so `position` carries no signal here).
 */
export function candidateSets(): CandidateSet[] {
	const lookalikes = new Set(["remix", "re-recording", "live", "edit"]);
	return musicbrainz.flatMap((c) => {
		if (!lookalikes.has(c.category) || c.provenance.source !== "musicbrainz") return [];
		const facts = recordings[c.provenance.a.recording];
		if (facts === undefined) return [];
		const elsewhere = facts.releases
			.filter((r) => normalise(r.title) !== normalise(c.a.album ?? ""))
			.sort(
				(x, y) =>
					draw(`${facts.id}|${x.title}|${x.date}`) - draw(`${facts.id}|${y.title}|${y.date}`),
			);
		const release = elsewhere[0];
		if (release === undefined) return [];
		const source: Song = {
			id: {},
			title: release.trackTitle ?? facts.title,
			artists: c.a.artists,
			album: release.title,
			...(release.date ? { date: release.date.slice(0, 10) } : {}),
			...(c.a.isrc ? { isrc: c.a.isrc } : {}),
			...((release.trackLengthMs ?? facts.lengthMs)
				? { durationMs: release.trackLengthMs ?? facts.lengthMs }
				: {}),
		};
		const swap = draw(`order|${pairKey(c)}`) < 0.5;
		const candidates = swap ? [c.b, c.a] : [c.a, c.b];
		return [
			{
				category: c.category,
				source,
				candidates,
				originalIndex: swap ? 1 : 0,
				tune: inTune(c),
				lookalikeSharesAlbum: normalise(c.b.album ?? "") === normalise(release.title),
				otherIsrc: facts.isrcs.filter((isrc) => isrc !== c.a.isrc).sort()[0],
			},
		];
	});
}
