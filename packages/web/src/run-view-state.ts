import type {
	FinishedRunStatus,
	LogEvent,
	RejectionEvent,
	ResultEvent,
	RunEvent,
	StageCounts,
	StageError,
	StageSlot,
} from "@ultrasonics/core/run-events";

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
	status: "running" | FinishedRunStatus;
	endedAt: number | null;
	stages: StageView[];
	results: ResultEvent[];
	log: LogEvent[];
}

export const emptyRunView = (): RunViewState => ({
	lastSeq: 0,
	status: "running",
	endedAt: null,
	stages: [],
	results: [],
	log: [],
});

const componentOrder = ["inputs", "modifiers", "outputs"];
const position = (slot: StageSlot) => componentOrder.indexOf(slot.component) * 10_000 + slot.index;

function withStage(
	stages: StageView[],
	slot: StageSlot,
	change: (stage: StageView) => StageView,
): StageView[] {
	const found = stages.find(
		(stage) => stage.component === slot.component && stage.index === slot.index,
	);
	const base: StageView = found ?? {
		component: slot.component,
		index: slot.index,
		plugin: slot.plugin,
		rejections: [],
		notShown: 0,
	};
	const updated = change(base);
	updated.notShown = Math.max(0, (updated.finished?.rejected ?? 0) - updated.rejections.length);
	return [...stages.filter((stage) => stage !== found), updated].sort(
		(a, b) => position(a) - position(b),
	);
}

/** Folds one run event into the view's state; a repeated `seq` leaves it unchanged. */
export function foldRunEvent(state: RunViewState, event: RunEvent): RunViewState {
	if (event.seq <= state.lastSeq) return state;
	const next = { ...state, lastSeq: event.seq };
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

/**
 * Songs written: each written playlist's supplied songs less its unmatched ones. Results carry no
 * per-playlist song count, so an output's supplied songs are its stage's when it wrote every
 * playlist it received, and unknown otherwise.
 */
export function headline(
	state: RunViewState,
	serviceOf: (plugin: string) => string | undefined,
): string {
	let written = 0;
	let known = true;
	const names: string[] = [];
	for (const result of state.results) {
		if (!result.outcome.ok) continue;
		const playlists = result.outcome.playlists;
		if (!playlists.some((playlist) => playlist.status === "written")) continue;
		const name = serviceOf(result.plugin) ?? result.plugin;
		if (!names.includes(name)) names.push(name);
		const supplied = state.stages.find(
			(stage) => stage.component === "outputs" && stage.index === result.index,
		)?.finished?.songs;
		if (supplied === undefined || playlists.some((playlist) => playlist.status !== "written")) {
			known = false;
			continue;
		}
		const unmatched = playlists.reduce(
			(sum, playlist) => sum + (playlist.status === "written" ? playlist.unmatched.length : 0),
			0,
		);
		written += supplied - unmatched;
	}
	if (names.length === 0) return "nothing written";
	const to = `written to ${joinNames(names)}`;
	return known ? `${written} ${written === 1 ? "song" : "songs"} ${to}` : `songs ${to}`;
}

function joinNames(names: string[]): string {
	return names.length === 1
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
