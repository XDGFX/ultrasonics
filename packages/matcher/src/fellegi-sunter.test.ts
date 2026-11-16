import { describe, expect, test } from "bun:test";
import { musicbrainzCases } from "./cc0-tier.ts";
import { fit } from "./fellegi-sunter.ts";
import { fitted } from "./fitted-weights.ts";
import { tuningCases } from "./split.ts";

describe("the fitted weights", () => {
	const refit = fit(tuningCases(musicbrainzCases));

	test("are what `bun run fit-weights` derives from the tuning split, untouched by hand", () => {
		expect(fitted).toEqual(refit);
	});

	test("give a field one side lacks no weight either way", () => {
		expect(refit.weights.length.missing).toBe(0);
		expect(refit.weights.year.missing).toBe(0);
	});

	// Fitted against the traps, an equal title came out as evidence *against* a match (#132).
	test("take u from random pairs, so an equal title counts for a match", () => {
		expect(refit.weights.title.equal).toBeGreaterThan(0);
	});

	test("set the medium band below the match threshold", () => {
		expect(refit.mediumThreshold).toBeLessThan(refit.matchThreshold);
	});
});
