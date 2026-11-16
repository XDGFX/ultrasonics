import type { Song } from "@ultrasonics/plugin-sdk";
import { type Agreement, agreement, lengthGapMs, lengthVetoMs } from "./agreement.ts";
import { versionMarkersIn } from "./version-marker.ts";

/** What the rules decide before any weighing: a hard key, a veto, or the agreement to weigh. */
export type Judgement =
	| { readonly kind: "hard" }
	| { readonly kind: "veto" }
	| { readonly kind: "weigh"; readonly agreement: Agreement };

const hard: Judgement = { kind: "hard" };
const veto: Judgement = { kind: "veto" };

export function judge(a: Song, b: Song): Judgement {
	if (sharesId(a, b)) return hard;
	if (a.location !== undefined && a.location === b.location) return hard;
	if ((lengthGapMs(a, b) ?? 0) > lengthVetoMs) return veto;
	// Some ISRCs are wrong, so an equal one still answers to the length veto.
	if (a.isrc !== undefined && a.isrc === b.isrc) return hard;
	// Without artists, a title alone can't tell a song from a stranger's.
	if (a.artists.length === 0 || b.artists.length === 0) return veto;
	if (!sameMembers(versionMarkersIn(a.title), versionMarkersIn(b.title))) return veto;
	return { kind: "weigh", agreement: agreement(a, b) };
}

function sharesId(a: Song, b: Song): boolean {
	return Object.entries(a.id).some(([space, id]) => b.id[space] === id);
}

function sameMembers<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
	return a.size === b.size && [...a].every((member) => b.has(member));
}
