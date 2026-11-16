import { z } from "zod";
import candidateSetsJson from "../test/fixtures/match-dataset/candidate-sets.json";
import handWrittenJson from "../test/fixtures/match-dataset/hand-written.json";
import musicbrainzJson from "../test/fixtures/match-dataset/musicbrainz.json";
import { CandidateSet } from "./candidate-set.ts";
import { MatchCase } from "./match-case.ts";

/** The CC0 tier's committed fixtures, parsed (spec #117 and #132). */
export const musicbrainzCases = z.array(MatchCase).parse(musicbrainzJson);
export const handWrittenCases = z.array(MatchCase).parse(handWrittenJson);
export const candidateSets = z.array(CandidateSet).parse(candidateSetsJson);
