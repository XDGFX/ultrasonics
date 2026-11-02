import { describe, expect, test } from "bun:test";
import { RunEvent } from "@ultrasonics/core/run-events";
import { authFailedRun, partialRun, succeededRun } from "./fake-runs.ts";
import { emptyRunView, foldRunEvent, headline, type RunViewState } from "./run-view-state.ts";

const fold = (script: unknown[], state: RunViewState = emptyRunView()) =>
	script.map((event) => RunEvent.parse(event)).reduce(foldRunEvent, state);

const services = (plugin: string) => ({ plex: "plex", spotify: "spotify" })[plugin];

describe("the run view's reducer", () => {
	test("folds a succeeded run into its stages, results, log and status", () => {
		const state = fold(succeededRun);
		expect(state.status).toBe("succeeded");
		expect(state.endedAt).toBe(Date.UTC(2026, 10, 2, 7, 0, 43));
		expect(
			state.stages.map((stage) => [stage.component, stage.plugin, stage.finished?.songs]),
		).toEqual([
			["inputs", "spotify", 60],
			["modifiers", "deduplicate", 57],
			["outputs", "plex", 57],
		]);
		expect(state.results.map((result) => result.plugin)).toEqual(["plex"]);
		expect(state.log.map((line) => [line.level, line.source])).toEqual([
			["info", "runner"],
			["info", "spotify"],
			["warn", "plex"],
		]);
	});

	test("is still running until the end arrives", () => {
		const state = fold(succeededRun.slice(0, 4));
		expect(state.status).toBe("running");
		expect(state.stages.map((stage) => stage.finished === undefined)).toEqual([false]);
	});

	test("counts songs written as supplied less unmatched, named by the outputs' services", () => {
		expect(headline(fold(succeededRun), services)).toBe("54 songs written to plex");
	});

	test("leaves the count out when an output skipped or failed a playlist", () => {
		expect(headline(fold(partialRun), services)).toBe("songs written to plex");
	});

	test("names nothing written when no output wrote", () => {
		expect(headline(fold(authFailedRun), services)).toBe("nothing written");
	});

	test("ignores an event whose seq it has already folded", () => {
		const once = fold(succeededRun);
		const again = fold(succeededRun.slice(5), fold(succeededRun.slice(0, 8)));
		expect(again).toEqual(once);
	});

	test("keeps each stage's rejections and how many the cap left out", () => {
		const [input] = fold(partialRun).stages;
		expect(input?.finished?.rejected).toBe(3);
		expect(input?.rejections.map((rejection) => rejection.playlist)).toEqual([0, 1]);
		expect(input?.notShown).toBe(1);
	});

	test("keeps a failed stage's error with its AuthFailure", () => {
		const [input] = fold(authFailedRun).stages;
		expect(input?.finished?.error?.code).toBe("reconnect");
		expect(input?.finished?.error?.auth?.service).toBe("spotify");
	});
});
