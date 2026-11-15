/**
 * Experiment for #132, not shipped: fits each variant on the tuning split, measures it on the
 * tuning split, the held-out split and the whole tier, and writes `experiment/results.md`.
 *
 *   bun experiment/run.ts
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Song } from "@ultrasonics/plugin-sdk";
import { bestMatch as shippedBestMatch } from "../src/best-match.ts";
import { measure, wilson } from "../src/harness.ts";
import { match as shippedMatch } from "../src/match.ts";
import { isPositive, type MatchCase, trapCategories } from "../src/match-case.ts";
import { normalise } from "../src/normalise.ts";
import { isRemastered, versionMarkersIn } from "../src/version-marker.ts";
import {
	type CandidateSet,
	candidateSets,
	evaluation,
	full,
	musicbrainz,
	tune,
	twoIsrcPositives,
} from "./data.ts";
import { isrcYear, levels, scriptLabel, yearOf } from "./fields.ts";
import {
	type FsWeights,
	type LengthRule,
	levelsKey,
	matches,
	type Variant,
	verdict,
} from "./matcher.ts";

const withoutIsrc = ({ isrc: _, ...song }: Song): Song => song;

// --- Measurement --------------------------------------------------------------------------------

interface Tally {
	k: number;
	n: number;
}
const rate = ({ k, n }: Tally) => (n === 0 ? undefined : k / n);
const pct = (x: number | undefined) => (x === undefined ? "–" : `${(x * 100).toFixed(1)}`);
const cell = (t: Tally) => {
	if (t.n === 0) return "–";
	const { lower, upper } = wilson(t.k, t.n);
	return `${pct(rate(t))} [${pct(lower)}–${pct(upper)}] (${t.n})`;
};
const short = (t: Tally) => (t.n === 0 ? "–" : `${pct(rate(t))} (${t.k}/${t.n})`);

interface Figures {
	recall: Tally;
	precision: Tally;
	rejection: Record<string, Tally>;
	byScript: Record<string, Tally>;
	unmarked: Record<string, Tally>;
	medium: { positives: number; traps: number };
	misses: MatchCase[];
	falseMatches: MatchCase[];
}

function evaluate(
	decide: (a: Song, b: Song) => boolean,
	cases: readonly MatchCase[],
	isrcVisible = false,
	band?: (a: Song, b: Song) => string,
): Figures {
	const f: Figures = {
		recall: { k: 0, n: 0 },
		precision: { k: 0, n: 0 },
		rejection: Object.fromEntries(trapCategories.map((c) => [c, { k: 0, n: 0 }])),
		byScript: {},
		unmarked: {},
		medium: { positives: 0, traps: 0 },
		misses: [],
		falseMatches: [],
	};
	for (const c of cases) {
		const [a, b] = isrcVisible ? [c.a, c.b] : [withoutIsrc(c.a), withoutIsrc(c.b)];
		const matched = decide(a, b);
		const positive = isPositive(c.category);
		if (band && band(a, b) === "medium") f.medium[positive ? "positives" : "traps"]++;
		if (matched) {
			f.precision.n++;
			if (positive) f.precision.k++;
		}
		if (positive) {
			f.recall.n++;
			if (matched) f.recall.k++;
			else f.misses.push(c);
			const script = scriptLabel(c.a, c.b);
			f.byScript[script] ??= { k: 0, n: 0 };
			f.byScript[script].n++;
			if (matched) f.byScript[script].k++;
		} else {
			const r = f.rejection[c.category] as Tally;
			r.n++;
			if (!matched) r.k++;
			else f.falseMatches.push(c);
			const marked =
				versionMarkersIn(c.a.title).size + versionMarkersIn(c.b.title).size > 0
					? "marked"
					: "unmarked";
			const key = `${c.category}/${marked}`;
			f.unmarked[key] ??= { k: 0, n: 0 };
			f.unmarked[key].n++;
			if (!matched) f.unmarked[key].k++;
		}
	}
	return f;
}

// --- Fitting ------------------------------------------------------------------------------------

/** Fellegi–Sunter weights from labelled pairs: m and u per level, add-half smoothed, as log2(m/u). */
function fitWeights(
	cases: readonly MatchCase[],
	o: { transliterate: boolean; isrc: boolean; fields?: readonly string[]; u?: "traps" | "random" },
): FsWeights {
	const counts: Record<string, Record<string, { m: number; u: number }>> = {};
	let positives = 0;
	let negatives = 0;
	const pairs: [Song, Song, boolean][] =
		o.u === "random"
			? [
					...cases
						.filter((c) => isPositive(c.category))
						.map((c) => [c.a, c.b, true] as [Song, Song, boolean]),
					...randomPairs(cases).map(([a, b]) => [a, b, false] as [Song, Song, boolean]),
				]
			: cases.map((c) => [c.a, c.b, isPositive(c.category)]);
	for (const [rawA, rawB, positive] of pairs) {
		const [a, b] = o.isrc ? [rawA, rawB] : [withoutIsrc(rawA), withoutIsrc(rawB)];
		const { level } = levels(a, b, o);
		if (positive) positives++;
		else negatives++;
		for (const [field, value] of Object.entries(level)) {
			if (o.fields && !o.fields.includes(field)) continue;
			counts[field] ??= {};
			counts[field][value] ??= { m: 0, u: 0 };
			counts[field][value][positive ? "m" : "u"]++;
		}
	}
	const weights: FsWeights = {};
	for (const [field, byLevel] of Object.entries(counts)) {
		const k = Object.keys(byLevel).length;
		weights[field] = {};
		for (const [value, { m, u }] of Object.entries(byLevel)) {
			const pm = (m + 0.5) / (positives + 0.5 * k);
			const pu = (u + 0.5) / (negatives + 0.5 * k);
			// A field one side lacks is no evidence either way (the F–S null level).
			weights[field][value] = value === "missing" ? 0 : Math.log2(pm / pu);
		}
	}
	return weights;
}

/**
 * Non-matches as Fellegi–Sunter estimates u: the `a` side of one case against the `b` side of
 * others, three shifts apart, never two sides of one recording. The traps are adversarial by
 * construction, so u taken from them learns how the tier was sampled, not how non-matches look.
 */
function randomPairs(cases: readonly MatchCase[]): [Song, Song][] {
	const mb = cases.filter((c) => c.provenance.source === "musicbrainz");
	const recording = (c: MatchCase, side: "a" | "b") =>
		c.provenance.source === "musicbrainz" ? c.provenance[side].recording : "";
	const out: [Song, Song][] = [];
	for (const shift of [1, 7, 31]) {
		for (const [i, c] of mb.entries()) {
			const other = mb[(i + shift) % mb.length] as MatchCase;
			if (recording(c, "a") === recording(other, "b")) continue;
			out.push([c.a, other.b]);
		}
	}
	return out;
}

/** The spec's `match` figure (#132): unmarked remix and re-recording traps within 3 s move to ranking. */
export function inMatchFigure(c: MatchCase): boolean {
	if (c.category !== "remix" && c.category !== "re-recording") return true;
	const marked = versionMarkersIn(c.a.title).size + versionMarkersIn(c.b.title).size > 0;
	const gap =
		c.a.durationMs !== undefined && c.b.durationMs !== undefined
			? Math.abs(c.a.durationMs - c.b.durationMs)
			: 0;
	return marked || gap > 3000;
}

/**
 * The two band thresholds, fitted on the tuning split: strong is the lowest score at which
 * precision reaches 99%, medium the highest at which recall still reaches 95% (or strong, if that
 * is lower already).
 */
function fitBands(
	scores: { score: number; positive: boolean }[],
	precision = 0.99,
): { strong: number; medium: number } {
	const finite = scores.filter((s) => Number.isFinite(s.score));
	const sorted = [...new Set(finite.map((s) => s.score))].sort((x, y) => x - y);
	const totalPositives = scores.filter((s) => s.positive).length;
	let strong = sorted.at(-1) ?? 0;
	let medium = strong;
	for (const t of sorted) {
		const above = scores.filter((s) => s.score >= t);
		const tp = above.filter((s) => s.positive).length;
		if (above.length > 0 && tp / above.length >= precision) {
			strong = t;
			break;
		}
	}
	for (const t of [...sorted].reverse()) {
		const tp = scores.filter((s) => s.positive && s.score >= t).length;
		if (tp / totalPositives >= 0.95) {
			medium = Math.min(t, strong);
			break;
		}
		medium = Math.min(t, strong);
	}
	return { strong, medium };
}

function fitted(base: Variant, isrcVisible = false, specFigure = false, precision = 0.99): Variant {
	const scores = tune
		.filter((c) => !specFigure || inMatchFigure(c))
		.map((c) => {
			const [a, b] = isrcVisible ? [c.a, c.b] : [withoutIsrc(c.a), withoutIsrc(c.b)];
			return { score: verdict(base, a, b).score, positive: isPositive(c.category) };
		});
	const { strong, medium } = fitBands(scores, precision);
	if (base.scoring.kind === "mean")
		return { ...base, scoring: { ...base.scoring, threshold: strong } };
	return { ...base, scoring: { ...base.scoring, strong, medium } } as Variant;
}

// --- Variants -----------------------------------------------------------------------------------

const cliff3: LengthRule = { kind: "cliff", toleranceMs: 3000 };
const cliff10: LengthRule = { kind: "cliff", toleranceMs: 10_000 };
/** beets' defaults (`track_length_grace: 10`, `track_length_max: 30`), vetoed at Picard's 30 s. */
const beetsLength: LengthRule = { kind: "grace", graceMs: 10_000, maxMs: 30_000, vetoMs: 30_000 };
/** A tighter grace inside the positives' p95 gap (3 s), the penalty to 30 s. */
const tightLength: LengthRule = { kind: "grace", graceMs: 3000, maxMs: 27_000, vetoMs: 30_000 };

const base = { isrcEvidence: false, acceptMedium: false } as const;
const mean = (transliterate: boolean, length: LengthRule, threshold = 0.85): Variant => ({
	...base,
	name: "",
	transliterate,
	length,
	scoring: { kind: "mean", threshold },
});

function fs(
	name: string,
	o: {
		transliterate: boolean;
		length?: LengthRule;
		fields?: readonly string[];
		tf?: boolean;
		isrc?: boolean;
		acceptMedium?: boolean;
		u?: "traps" | "random";
		specFigure?: boolean;
		precision?: number;
	},
): Variant {
	const weights = fitWeights(tune, {
		transliterate: o.transliterate,
		isrc: o.isrc ?? false,
		fields: o.fields,
		u: o.u,
	});
	let titleFrequency: Map<string, number> | undefined;
	if (o.tf) {
		// Distinct recordings per normalised title, over the tuning split's songs only.
		const titles = new Map<string, Set<string>>();
		for (const c of tune) {
			if (c.provenance.source !== "musicbrainz") continue;
			for (const [song, rec] of [
				[c.a, c.provenance.a.recording],
				[c.b, c.provenance.b.recording],
			] as const) {
				const key = levelsKey(song.title);
				titles.set(key, (titles.get(key) ?? new Set()).add(rec));
			}
		}
		const recordingCount = new Set([...titles.values()].flatMap((s) => [...s])).size;
		titleFrequency = new Map([...titles].map(([k, s]) => [k, s.size / recordingCount]));
		titleFrequency.set("__floor__", 1 / recordingCount);
		const negatives = tune.filter((c) => !isPositive(c.category));
		const equalU =
			negatives.filter(
				(c) =>
					levels(c.a, c.b, { transliterate: o.transliterate, isrc: false }).level.title === "equal",
			).length / negatives.length;
		titleFrequency.set("__u_equal__", equalU);
	}
	return fitted(
		{
			name,
			transliterate: o.transliterate,
			length: o.length ?? tightLength,
			isrcEvidence: o.isrc ?? false,
			acceptMedium: o.acceptMedium ?? false,
			scoring: { kind: "fs", weights, strong: 0, medium: 0, titleFrequency },
		},
		o.isrc ?? false,
		o.specFigure ?? false,
		o.precision ?? 0.99,
	);
}

const beetsWeights = { title: 3, artist: 2, length: 2, album: 0, year: 0 };
const picardWeights = { title: 13, artist: 4, length: 10, album: 5, year: 4 };
const picardLength: LengthRule = { kind: "grace", graceMs: 0, maxMs: 30_000, vetoMs: 30_000 };

const variants: Variant[] = [
	{ ...mean(true, cliff3), name: "B1 baseline + transliteration" },
	{ ...mean(false, cliff10), name: "B2 baseline, length cliff 10 s" },
	{ ...mean(true, cliff10), name: "B3 baseline + translit + cliff 10 s" },
	fitted({ ...mean(true, cliff10), name: "B4 B3, threshold refitted" }),
	{
		...base,
		name: "W1 beets weights + beets bands (0.04 / 0.25)",
		transliterate: false,
		length: beetsLength,
		scoring: { kind: "weighted", weights: beetsWeights, strong: 0.04, medium: 0.25 },
	},
	fitted({
		...base,
		name: "W2 beets weights, bands fitted",
		transliterate: false,
		length: beetsLength,
		scoring: { kind: "weighted", weights: beetsWeights, strong: 0, medium: 0 },
	}),
	fitted({
		...base,
		name: "W3 Picard weights, bands fitted",
		transliterate: false,
		length: picardLength,
		scoring: { kind: "weighted", weights: picardWeights, strong: 0, medium: 0 },
	}),
	fs("T1 F–S, u from the traps (all fields, translit)", { transliterate: true, u: "traps" }),
	fs("T2 T1, medium accepted", { transliterate: true, u: "traps", acceptMedium: true }),
	fs("F1 F–S, u from random pairs: title, artist, length", {
		transliterate: false,
		u: "random",
		fields: ["title", "artist", "length"],
	}),
	fs("F2 F1 + album, year", { transliterate: false, u: "random" }),
	fs("F3 F2 + transliteration", { transliterate: true, u: "random" }),
	fs("F4 F3 + title term frequency", { transliterate: true, u: "random", tf: true }),
	fs("F5 F3, bands fitted on the spec's match figure", {
		transliterate: true,
		u: "random",
		specFigure: true,
	}),
	fs("F6 F5, medium accepted", {
		transliterate: true,
		u: "random",
		specFigure: true,
		acceptMedium: true,
	}),
	fs("P1 F1 + translit, one threshold at the baseline's 90% tune precision", {
		transliterate: true,
		u: "random",
		fields: ["title", "artist", "length"],
		precision: 0.9,
	}),
	fs("P2 F3 (all fields), one threshold at 90% tune precision", {
		transliterate: true,
		u: "random",
		precision: 0.9,
	}),
];

// --- Report -------------------------------------------------------------------------------------

const out: string[] = [];
const say = (line = "") => {
	out.push(line);
	console.log(line);
};

const shippedReport = measure(shippedMatch, full);
say(`# Experiment results (generated by experiment/run.ts)`);
say();
say(
	`Tune split: ${tune.length} MusicBrainz cases (${tune.filter((c) => isPositive(c.category)).length} positives). ` +
		`Held-out split: ${evaluation.length} cases (rest of MusicBrainz + ${full.length - musicbrainz.length} hand-written). ` +
		`Full tier: ${full.length}.`,
);
say();
say(
	`Shipped harness on the full tier: recall ${pct(shippedReport.recall.rate)}, precision ${pct(shippedReport.precision.rate)}, ` +
		`remix ${pct(shippedReport.rejection.remix.rate)}, re-recording ${pct(shippedReport.rejection["re-recording"].rate)}.`,
);
say();

type Row = { name: string; tune: Figures; held: Figures; full: Figures; v?: Variant };
const rows: Row[] = [];
const shipped = (a: Song, b: Song) => shippedMatch(a, b).matched;
rows.push({
	name: "B0 baseline (shipped `match`)",
	tune: evaluate(shipped, tune),
	held: evaluate(shipped, evaluation),
	full: evaluate(shipped, full),
});
for (const v of variants) {
	const decide = (a: Song, b: Song) => matches(v, a, b);
	const band = (a: Song, b: Song) => verdict(v, a, b).band;
	rows.push({
		name: v.name,
		v,
		tune: evaluate(decide, tune, false, band),
		held: evaluate(decide, evaluation, false, band),
		full: evaluate(decide, full, false, band),
	});
}

const traps = ["cover", "live", "edit", "remix", "re-recording", "same-title"];
for (const split of ["held", "tune", "full"] as const) {
	say(
		`## Pairwise figures, ISRC hidden — ${split === "held" ? "held-out split" : split === "tune" ? "tuning split" : "full tier"}`,
	);
	say();
	say(`Each cell: rate % [95% Wilson interval] (n).`);
	say();
	say(`| Variant | Recall | Precision | ${traps.join(" | ")} |`);
	say(`|---|---|---|${traps.map(() => "---").join("|")}|`);
	for (const r of rows) {
		const f = r[split];
		say(
			`| ${r.name} | ${cell(f.recall)} | ${cell(f.precision)} | ${traps.map((t) => cell(f.rejection[t] as Tally)).join(" | ")} |`,
		);
	}
	say();
}

say(`## Recall by script (held-out split)`);
say();
const scripts = ["latin", "same-non-latin", "cross-script"];
say(`| Variant | ${scripts.join(" | ")} |`);
say(`|---|${scripts.map(() => "---").join("|")}|`);
for (const r of rows)
	say(
		`| ${r.name} | ${scripts.map((s) => cell(r.held.byScript[s] ?? { k: 0, n: 0 })).join(" | ")} |`,
	);
say();

say(`## Remix and re-recording rejection, split by version marker (full tier)`);
say();
const markerKeys = [
	"remix/marked",
	"remix/unmarked",
	"re-recording/marked",
	"re-recording/unmarked",
	"live/marked",
	"live/unmarked",
	"edit/marked",
	"edit/unmarked",
];
say(`| Variant | ${markerKeys.join(" | ")} |`);
say(`|---|${markerKeys.map(() => "---").join("|")}|`);
for (const r of rows)
	say(
		`| ${r.name} | ${markerKeys.map((k) => short(r.full.unmarked[k] ?? { k: 0, n: 0 })).join(" | ")} |`,
	);
say();

say(`## Medium band (full tier): pairs banded medium`);
say();
say(`| Variant | positives in medium | traps in medium |`);
say(`|---|---|---|`);
for (const r of rows.filter((r) => r.v && r.v.scoring.kind !== "mean")) {
	say(`| ${r.name} | ${r.full.medium.positives} | ${r.full.medium.traps} |`);
}
say();

// --- Misses moved -------------------------------------------------------------------------------

const missCause = (c: MatchCase): string => {
	const gap =
		c.a.durationMs !== undefined && c.b.durationMs !== undefined
			? Math.abs(c.a.durationMs - c.b.durationMs)
			: 0;
	if (scriptLabel(c.a, c.b) === "cross-script") return "cross-script";
	if (gap > 3000) return "length > 3 s";
	const { sims } = levels(withoutIsrc(c.a), withoutIsrc(c.b), {
		transliterate: false,
		isrc: false,
	});
	if (sims.title < 0.85) return "title differs";
	if (sims.artist < 0.85) return "artist differs";
	if (versionMarkersIn(c.a.title).size + versionMarkersIn(c.b.title).size > 0)
		return "version marker";
	return "score below threshold";
};
say(`## Baseline misses (full tier) by cause, and how many each variant recovers`);
say();
const baseMisses = rows[0]?.full.misses ?? [];
const causes = [...new Set(baseMisses.map(missCause))];
say(
	`| Variant | ${causes.map((c) => `${c} (${baseMisses.filter((m) => missCause(m) === c).length})`).join(" | ")} | new misses |`,
);
say(`|---|${causes.map(() => "---").join("|")}|---|`);
for (const r of rows.slice(1)) {
	const missed = new Set(r.full.misses);
	const recovered = causes.map(
		(cause) => baseMisses.filter((m) => missCause(m) === cause && !missed.has(m)).length,
	);
	const fresh = r.full.misses.filter((m) => !baseMisses.includes(m)).length;
	say(`| ${r.name} | ${recovered.join(" | ")} | ${fresh} |`);
}
say();

// --- ISRC visible -------------------------------------------------------------------------------

const twoIsrcTune = twoIsrcPositives(tune);
const twoIsrcHeld = twoIsrcPositives(musicbrainz.filter((c) => !tune.includes(c)));
const trapsOnly = (cases: readonly MatchCase[]) => cases.filter((c) => !isPositive(c.category));
say(`## ISRC visible`);
say();
say(
	`Positives whose recording carries a second ISRC in MusicBrainz, rebuilt with the second one on side b: ` +
		`${twoIsrcTune.length} in the tuning split, ${twoIsrcHeld.length} held out. Each is scored with the traps of its split (ISRCs visible).`,
);
say();
const isrcFacts = [...twoIsrcTune, ...twoIsrcHeld].map((c) => {
	const [a, b] = [c.a.isrc as string, c.b.isrc as string];
	return { sameReg: a.slice(0, 5) === b.slice(0, 5), gap: Math.abs(isrcYear(a) - isrcYear(b)) };
});
const trapIsrc = trapsOnly(musicbrainz)
	.filter((c) => c.a.isrc && c.b.isrc)
	.map((c) => ({
		category: c.category,
		sameReg: (c.a.isrc as string).slice(0, 5) === (c.b.isrc as string).slice(0, 5),
		gap: Math.abs(isrcYear(c.a.isrc as string) - isrcYear(c.b.isrc as string)),
	}));
say(`| Pairs | n | same registrant | year codes ≥ 5 apart |`);
say(`|---|---|---|---|`);
say(
	`| Two-ISRC positives | ${isrcFacts.length} | ${isrcFacts.filter((x) => x.sameReg).length} | ${isrcFacts.filter((x) => x.gap >= 5).length} |`,
);
for (const cat of traps) {
	const t = trapIsrc.filter((x) => x.category === cat);
	say(
		`| ${cat} traps | ${t.length} | ${t.filter((x) => x.sameReg).length} | ${t.filter((x) => x.gap >= 5).length} |`,
	);
}
say();

const visibleBase = fs("F5 (ISRC visible, equality only)", {
	transliterate: true,
	u: "random",
	specFigure: true,
});
// Only pairs whose ISRCs differ reach the scorer, so the ISRC field's m comes from the tuning
// split's two-ISRC positives alone and its u from the traps; every other field keeps F5's weights.
const reachScorer = [...trapsOnly(tune), ...twoIsrcTune];
const isrcWeights = fitWeights(reachScorer, { transliterate: true, isrc: true, fields: ["isrc"] });
const visibleEvidence: Variant = (() => {
	const f3 = visibleBase.scoring.kind === "fs" ? visibleBase.scoring.weights : {};
	const v: Variant = {
		name: "F7 F5 + ISRC year/registrant as evidence",
		transliterate: true,
		length: tightLength,
		isrcEvidence: true,
		acceptMedium: false,
		scoring: { kind: "fs", weights: { ...f3, ...isrcWeights }, strong: 0, medium: 0 },
	};
	const scores = reachScorer.map((c) => ({
		score: verdict(v, c.a, c.b).score,
		positive: isPositive(c.category),
	}));
	const { strong, medium } = fitBands(scores);
	return { ...v, scoring: { ...v.scoring, strong, medium } } as Variant;
})();
const heldVisible = [...trapsOnly(musicbrainz.filter((c) => !tune.includes(c))), ...twoIsrcHeld];
say(`| Variant (held-out, ISRC visible) | two-ISRC recall | precision | ${traps.join(" | ")} |`);
say(`|---|---|---|${traps.map(() => "---").join("|")}|`);
for (const v of [visibleBase, visibleEvidence]) {
	const f = evaluate((a, b) => matches(v, a, b), heldVisible, true);
	say(
		`| ${v.name} | ${cell(f.recall)} | ${cell(f.precision)} | ${traps.map((t) => cell(f.rejection[t] as Tally)).join(" | ")} |`,
	);
}
{
	const f = evaluate(shipped, heldVisible, true);
	say(
		`| B0 shipped, ISRC visible | ${cell(f.recall)} | ${cell(f.precision)} | ${traps.map((t) => cell(f.rejection[t] as Tally)).join(" | ")} |`,
	);
}
say();
say(`ISRC weights fitted (log2 m/u): ${JSON.stringify(isrcWeights.isrc)}`);
say();

// --- Ranking ------------------------------------------------------------------------------------

type Picker = (source: Song, candidates: readonly Song[]) => number | undefined;
const sameAlbum = (s: Song, c: Song) =>
	s.album && c.album && normalise(s.album) === normalise(c.album) ? 1 : 0;
const earlier = (y: number | undefined) => (y === undefined ? 0 : -y);

type Signal = "album" | "isrc-year" | "date";
type Judge = (
	source: Song,
	candidate: Song,
) => { band: "strong" | "medium"; score: number } | undefined;

const judgeBy =
	(v: Variant, acceptMedium: boolean): Judge =>
	(source, c) => {
		const { band, score } = verdict(v, source, c);
		if (band === "none" || (band === "medium" && !acceptMedium)) return undefined;
		return { band, score: Number.isFinite(score) ? score : 1e9 };
	};
const shippedJudge: Judge = (source, c) => {
	const { matched, score } = shippedMatch(source, c);
	return matched ? { band: "strong", score } : undefined;
};

function picker(
	judge: Judge,
	order: "score-first" | "evidence-first",
	signals: readonly Signal[] = ["album", "isrc-year", "date"],
): Picker {
	return (source, candidates) => {
		let best: { i: number; key: number[] } | undefined;
		for (const [i, c] of candidates.entries()) {
			const judged = judge(source, c);
			if (judged === undefined) continue;
			const prefs = [
				source.explicit === undefined || c.explicit === source.explicit ? 1 : 0,
				isRemastered(c.title) ? 0 : 1,
			];
			const evidence = signals.map((signal) =>
				signal === "album"
					? sameAlbum(source, c)
					: signal === "isrc-year"
						? earlier(c.isrc ? isrcYear(c.isrc) : undefined)
						: earlier(yearOf(c.date)),
			);
			const bandRank = judged.band === "strong" ? 1 : 0;
			const key =
				order === "score-first"
					? [bandRank, ...prefs, judged.score, ...evidence, -i]
					: [bandRank, ...prefs, ...evidence, judged.score, -i];
			if (best === undefined || outranks(key, best.key)) best = { i, key };
		}
		return best?.i;
	};
}
/**
 * A set matches only when some candidate passes `gate`; the choice is then `rank`'s, over a wider
 * band, so a near-miss original can beat a lookalike that passed alone.
 */
const gated =
	(gate: Judge, rank: Picker): Picker =>
	(source, candidates) =>
		candidates.some((c) => gate(source, c) !== undefined) ? rank(source, candidates) : undefined;

function outranks(a: readonly number[], b: readonly number[]): boolean {
	for (const [i, value] of a.entries()) {
		const other = b[i] ?? 0;
		if (value !== other) return value > other;
	}
	return false;
}

const sets = candidateSets();
const heldSets = sets.filter((s) => !s.tune);
say(`## Ranking (bestMatch) on candidate sets, held-out split`);
say();
say(
	`${sets.length} candidate sets (${heldSets.length} held out): each remix, re-recording, live and edit trap whose original recording ` +
		`MusicBrainz lists on another release. Source = the original on that other release; candidates = the original as the tier has it, ` +
		`and the lookalike, in a seeded order. Each cell: picks the original % (n) / picks the lookalike / picks nothing.`,
);
say();
const rank = (p: Picker, s: readonly CandidateSet[], visible: boolean) => {
	let right = 0;
	let wrong = 0;
	let nothing = 0;
	for (const set of s) {
		const strip = (song: Song) => (visible ? song : withoutIsrc(song));
		const i = p(strip(set.source), set.candidates.map(strip));
		if (i === undefined) nothing++;
		else if (i === set.originalIndex) right++;
		else wrong++;
	}
	return { right, wrong, nothing, n: s.length };
};
const rankCell = (r: { right: number; wrong: number; nothing: number; n: number }) =>
	r.n === 0
		? "–"
		: `${cell({ k: r.right, n: r.n })} / ${pct(r.wrong / r.n)} / ${pct(r.nothing / r.n)}`;
const lookCats = ["remix", "re-recording", "live", "edit"];
const best = rows.find((r) => r.name.startsWith("F5"))?.v as Variant;
const p1 = rows.find((r) => r.name.startsWith("P1"))?.v as Variant;
const shippedPicker: Picker = (s, c) => shippedBestMatch(s, c)?.index;
const pickers: [string, Picker][] = [
	["B0 shipped bestMatch", shippedPicker],
	[
		"B0 acceptance, evidence first (album, ISRC year, date)",
		picker(shippedJudge, "evidence-first"),
	],
	["B0 acceptance, evidence first, album only", picker(shippedJudge, "evidence-first", ["album"])],
	["F5, strong only, score first (spec order)", picker(judgeBy(best, false), "score-first")],
	["F5, medium accepted, score first (spec order)", picker(judgeBy(best, true), "score-first")],
	[
		"F5, medium accepted, evidence first (album, ISRC year, date)",
		picker(judgeBy(best, true), "evidence-first"),
	],
	[
		"F5, medium accepted, evidence first, album only",
		picker(judgeBy(best, true), "evidence-first", ["album"]),
	],
	[
		"F5, medium accepted, evidence first, date before ISRC year",
		picker(judgeBy(best, true), "evidence-first", ["album", "date", "isrc-year"]),
	],
	[
		"P1 acceptance, evidence first (album, date, ISRC year)",
		picker(judgeBy(p1, false), "evidence-first", ["album", "date", "isrc-year"]),
	],
	[
		"H1 hybrid: P1 gates, then F5 medium-or-better ranked by evidence (album, date, ISRC year)",
		gated(
			judgeBy(p1, false),
			picker(judgeBy(best, true), "evidence-first", ["album", "date", "isrc-year"]),
		),
	],
];
say(`ISRC hidden:`);
say();
say(`| Picker | all | ${lookCats.join(" | ")} |`);
say(`|---|---|${lookCats.map(() => "---").join("|")}|`);
for (const [name, p] of pickers) {
	say(
		`| ${name} | ${rankCell(rank(p, heldSets, false))} | ${lookCats
			.map((c) =>
				rankCell(
					rank(
						p,
						heldSets.filter((s) => s.category === c),
						false,
					),
				),
			)
			.join(" | ")} |`,
	);
}
say();
// With the original's own ISRC on the source, every picker that honours ISRC equality is right by
// construction; the informative case is a source carrying the recording's *other* ISRC.
const twoIsrcSets = sets
	.filter((s) => s.otherIsrc !== undefined)
	.map((s) => ({ ...s, source: { ...s.source, isrc: s.otherIsrc as string } }));
say(
	`ISRC visible, the source carrying the original recording's other ISRC (all splits, n = ${twoIsrcSets.length}; ` +
		`the source's own ISRC equals neither candidate's):`,
);
say();
say(`| Picker | all |`);
say(`|---|---|`);
for (const [name, p] of [
	...pickers,
	[
		"F7 (ISRC evidence), medium accepted, evidence first",
		picker(judgeBy(visibleEvidence, true), "evidence-first"),
	] as [string, Picker],
]) {
	say(`| ${name} | ${rankCell(rank(p, twoIsrcSets, true))} |`);
}
say();
// When the service lacks the original, the only right answer is nothing: what accepting the
// medium band costs.
const lookalikeOnly = heldSets.map((s) => ({
	...s,
	candidates: [s.candidates[1 - s.originalIndex] as Song],
	originalIndex: -1,
}));
say(
	`Lookalike only (held-out, ISRC hidden; the original is not on the service, so the right answer is nothing):`,
);
say();
say(`| Picker | picks nothing (right) | ${lookCats.join(" | ")} |`);
say(`|---|---|${lookCats.map(() => "---").join("|")}|`);
for (const [name, p] of pickers) {
	const nothing = (s: readonly CandidateSet[]) => {
		const r = rank(p, s, false);
		return cell({ k: r.nothing, n: r.n });
	};
	say(
		`| ${name} | ${nothing(lookalikeOnly)} | ${lookCats.map((c) => nothing(lookalikeOnly.filter((s) => s.category === c))).join(" | ")} |`,
	);
}
say();
say(
	`Lookalike shares the source's album title in ${sets.filter((s) => s.lookalikeSharesAlbum).length} of ${sets.length} sets.`,
);
say();

say(`## Fitted Fellegi–Sunter weights for F5 (log2 m/u, tuning split)`);
say();
if (best.scoring.kind === "fs") {
	for (const [field, byLevel] of Object.entries(best.scoring.weights)) {
		say(
			`- **${field}**: ${Object.entries(byLevel)
				.map(([l, w]) => `${l} ${w.toFixed(2)}`)
				.join(", ")}`,
		);
	}
	say(
		`- bands: strong ≥ ${best.scoring.strong.toFixed(2)}, medium ≥ ${best.scoring.medium.toFixed(2)}`,
	);
}
say();

await writeFile(join(import.meta.dir, "results.md"), `${out.join("\n")}\n`);
