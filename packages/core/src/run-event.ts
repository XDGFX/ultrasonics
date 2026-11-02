import { AuthFailure, Component, LogLevel, PlaylistResult, Song } from "@ultrasonics/plugin-sdk";
import { z } from "zod";

// Imported by the UI through `@ultrasonics/core/run-events`: nothing from the runner, only Zod and
// the SDK's schemas.

/** How a run ended. The runner never produces `interrupted`; boot sets it (ADR-0018 §4). */
export const FinishedRunStatus = z.enum(["succeeded", "partial", "failed", "interrupted"]);
export type FinishedRunStatus = z.infer<typeof FinishedRunStatus>;

/** Why a stage failed: the runner's own codes, or the `AuthFailure` code it caught (ADR-0013 §6). */
export const StageErrorCode = z.enum([
	"unknown-plugin",
	"missing-component",
	"settings-invalid",
	"threw",
	"contract",
	...AuthFailure.shape.code.options,
]);
export type StageErrorCode = z.infer<typeof StageErrorCode>;

export const StageError = z.object({
	code: StageErrorCode,
	message: z.string(),
	auth: AuthFailure.optional(),
});
export type StageError = z.infer<typeof StageError>;

/** Assigned by the runner: `seq` counts from 1 within the run, `at` is epoch milliseconds. */
const base = { seq: z.number().int().min(1), at: z.number() };

/** One component instance: its component, position within that component, and plugin name. */
export const StageSlot = z.object({
	component: Component,
	index: z.number().int().min(0),
	plugin: z.string(),
});
export type StageSlot = z.infer<typeof StageSlot>;

/** What a finished stage counts. */
export const StageCounts = z.object({
	/** Songs and playlists out; for an output, those it received. */
	songs: z.number().int().min(0),
	playlists: z.number().int().min(0),
	/** Every rejection in the stage, including those past the emitted cap. */
	rejected: z.number().int().min(0),
});
export type StageCounts = z.infer<typeof StageCounts>;

export const LogEvent = z.object({
	...base,
	type: z.literal("log"),
	level: LogLevel,
	/** `runner`, or the name of the plugin that logged it. */
	source: z.string(),
	text: z.string(),
});
export type LogEvent = z.infer<typeof LogEvent>;

export const StageEvent = z.discriminatedUnion("state", [
	z.object({ ...base, type: z.literal("stage"), ...StageSlot.shape, state: z.literal("started") }),
	z.object({
		...base,
		type: z.literal("stage"),
		...StageSlot.shape,
		state: z.literal("finished"),
		...StageCounts.shape,
		error: StageError.optional(),
	}),
]);
export type StageEvent = z.infer<typeof StageEvent>;

/** A playlist or song dropped from what a plugin returned, in the shape ADR-0021 §5 stores. */
export const RejectionEvent = z.object({
	...base,
	type: z.literal("rejection"),
	...StageSlot.shape,
	playlist: z.number().int().min(0),
	playlistName: z.string().optional(),
	/** Absent when the whole playlist was dropped. */
	song: z.number().int().min(0).optional(),
	songTitle: z.string().optional(),
	issues: z.array(
		z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }),
	),
});
export type RejectionEvent = z.infer<typeof RejectionEvent>;

/** The playlist's name, and how many of its songs the output was supplied. */
const playlistFields = { playlistName: z.string(), supplied: z.number().int().min(0) };

/** A playlist's result, with copies of a written one's unmatched songs beside their positions. */
const ResultPlaylist = z.discriminatedUnion("status", [
	PlaylistResult.options[0].extend({ ...playlistFields, unmatchedSongs: z.array(Song) }),
	PlaylistResult.options[1].extend(playlistFields),
	PlaylistResult.options[2].extend(playlistFields),
]);
export type ResultPlaylist = z.infer<typeof ResultPlaylist>;

export const ResultEvent = z.object({
	...base,
	type: z.literal("result"),
	/** The output's position among the applet's outputs. */
	index: z.number().int().min(0),
	plugin: z.string(),
	outcome: z.discriminatedUnion("ok", [
		z.object({ ok: z.literal(true), playlists: z.array(ResultPlaylist) }),
		z.object({ ok: z.literal(false), error: StageError }),
	]),
});
export type ResultEvent = z.infer<typeof ResultEvent>;

export const EndEvent = z.object({ ...base, type: z.literal("end"), status: FinishedRunStatus });
export type EndEvent = z.infer<typeof EndEvent>;

/** One thing that happened during a run, as the run view sees it (ADR-0026 §2). */
export const RunEvent = z.discriminatedUnion("type", [
	LogEvent,
	StageEvent,
	RejectionEvent,
	ResultEvent,
	EndEvent,
]);
export type RunEvent = z.infer<typeof RunEvent>;

/** Where the runner sends a run's events; the server's hub journals and fans them out. */
export interface RunEvents {
	emit(event: RunEvent): void;
}
