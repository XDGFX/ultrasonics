import { z } from "zod";
import { CaseSong } from "./match-case.ts";

export const lookalikeCategories = ["remix", "re-recording", "live", "edit"] as const;
export const LookalikeCategory = z.enum(lookalikeCategories);
export type LookalikeCategory = z.output<typeof LookalikeCategory>;

/**
 * A ranking case for `bestMatch` (#132): the source is a trap's original recording on another of
 * its releases, and the candidates are that original as the tier has it and the trap's lookalike,
 * in a seeded order, so `position` carries no signal.
 */
export const CandidateSet = z.object({
	category: LookalikeCategory,
	source: CaseSong,
	candidates: z.tuple([CaseSong, CaseSong]),
	/** Which candidate is the original recording. */
	original: z.union([z.literal(0), z.literal(1)]),
	/** The trap case's recordings, which put the set on the same side of the split as the trap. */
	trap: z.object({ a: z.uuid(), b: z.uuid() }),
});
export type CandidateSet = z.output<typeof CandidateSet>;
export type CandidateSetInput = z.input<typeof CandidateSet>;
