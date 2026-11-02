import type {
	LogEvent,
	RejectionEvent,
	ResultEvent,
	ResultPlaylist,
	RunEvent,
	StageCounts,
	StageError,
	StageSlot,
} from "@ultrasonics/core/run-events";
import { Component } from "@ultrasonics/plugin-sdk";
import type { RunStatus } from "./api-client.ts";

export interface StageView extends StageSlot {
	/** Absent while the stage is running. */
	finished?: StageCounts & { error?: StageError };
	rejections: RejectionEvent[];
	/** Rejections the stage counted beyond those emitted (ADR-0021's cap). */
	notShown: number;
}

/** What the run view shows, folded from run events alone (ADR-0026 §4). */
export interface RunViewState {
	/** The highest `seq` folded; an event at or below it is a repeat. */
	lastSeq: number;
	status: RunStatus;
	endedAt: number | null;
	/** When the latest event happened, so a live run's duration grows as events arrive. */
	lastAt: number | null;
	stages: StageView[];
	results: ResultEvent[];
	log: LogEvent[];
}

export const emptyRunView = (): RunViewState => ({
	lastSeq: 0,
	status: "running",
	endedAt: null,
	lastAt: null,
	stages: [],
	results: [],
	log: [],
});

const byPosition = (a: StageSlot, b: StageSlot) =>
	Component.options.indexOf(a.component) - Component.options.indexOf(b.component) ||
	a.index - b.index;

const isSlot = (slot: StageSlot) => (stage: StageSlot) =>
	stage.component === slot.component && stage.index === slot.index;

function withStage(
	stages: StageView[],
	slot: StageSlot,
	change: (stage: StageView) => StageView,
): StageView[] {
	const found = stages.find(isSlot(slot));
	const base: StageView = found ?? {
		component: slot.component,
		index: slot.index,
		plugin: slot.plugin,
		rejections: [],
		notShown: 0,
	};
	const updated = change(base);
	updated.notShown = Math.max(0, (updated.finished?.rejected ?? 0) - updated.rejections.length);
	return [...stages.filter((stage) => stage !== found), updated].sort(byPosition);
}

/** Folds one run event into the view's state; a repeated `seq` leaves it unchanged. */
export function foldRunEvent(state: RunViewState, event: RunEvent): RunViewState {
	if (event.seq <= state.lastSeq) return state;
	const next = { ...state, lastSeq: event.seq, lastAt: event.at };
	switch (event.type) {
		case "log":
			return { ...next, log: [...state.log, event] };
		case "stage":
			return {
				...next,
				stages: withStage(state.stages, event, (stage) => {
					if (event.state === "started") return stage;
					const { songs, playlists, rejected, error } = event;
					return {
						...stage,
						finished: { songs, playlists, rejected, ...(error ? { error } : {}) },
					};
				}),
			};
		case "rejection":
			return {
				...next,
				stages: withStage(state.stages, event, (stage) => ({
					...stage,
					rejections: [...stage.rejections, event],
				})),
			};
		case "result":
			return { ...next, results: [...state.results, event] };
		case "end":
			return { ...next, status: event.status, endedAt: event.at };
	}
}

type WrittenPlaylist = Extract<ResultPlaylist, { status: "written" }>;

/** Songs written: each written playlist's supplied songs less its unmatched ones (ADR-0020). */
export function headline(
	state: RunViewState,
	serviceOf: (plugin: string) => string | undefined,
): string {
	let written = 0;
	const names: string[] = [];
	for (const result of state.results) {
		if (!result.outcome.ok) continue;
		const wrote = result.outcome.playlists.filter(
			(playlist): playlist is WrittenPlaylist => playlist.status === "written",
		);
		if (wrote.length === 0) continue;
		written += wrote.reduce((sum, playlist) => sum + matched(playlist), 0);
		const name = serviceOf(result.plugin) ?? result.plugin;
		if (!names.includes(name)) names.push(name);
	}
	if (names.length === 0) return "nothing written";
	return `${written} ${written === 1 ? "song" : "songs"} written to ${joinNames(names)}`;
}

/** A written playlist's songs that found a counterpart on the service. */
export const matched = (playlist: WrittenPlaylist) => playlist.supplied - playlist.unmatched.length;

function joinNames(names: string[]): string {
	return names.length === 1
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
