// The `@ultrasonics/server/api` subpath, which the UI imports: Zod schemas for every request and
// response, and nothing that runs the server (enforced by a `noRestrictedImports` override in
// biome.json). Response schemas are written for the API, never re-exported db rows, so no column the
// UI doesn't name can leak.

import { FinishedRunStatus } from "@ultrasonics/core/run-events";
import type { JsonValue, RunTrigger as StoredRunTrigger } from "@ultrasonics/db";
import {
	AuthChallenge,
	AuthFailure,
	AuthRequirement,
	Component,
	Flow,
	type JSONSchema,
	Mode,
	Service,
} from "@ultrasonics/plugin-sdk";
import { z } from "zod";

export { AuthChallenge, AuthRequirement };

/** A form JSON Schema from `toFormSchema`, as the plugin catalogue and the client form carry it. */
export const JsonSchema = z.custom<JSONSchema>(
	(value) => typeof value === "object" && value !== null && !Array.isArray(value),
);

export const ValidationIssue = z.object({
	path: z.array(z.union([z.string(), z.number()])),
	message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

/** Every `4xx` and `5xx` body except a `422`. */
export const ErrorBody = z.object({ message: z.string() });
export type ErrorBody = z.infer<typeof ErrorBody>;

/** A `422` body: what failed validation, by path. */
export const IssuesBody = z.object({ issues: z.array(ValidationIssue) });
export type IssuesBody = z.infer<typeof IssuesBody>;

export const InstanceInfo = z.object({
	/** Reached from a public address while the session source is `bootstrapped` (ADR-0015 §6). */
	exposed: z.boolean(),
});
export type InstanceInfo = z.infer<typeof InstanceInfo>;

export const PluginInfo = z.object({
	name: z.string(),
	description: z.string(),
	version: z.string(),
	components: z.array(Component),
	mode: z.array(Mode),
	service: Service.optional(),
	/** Form JSON Schema; absent when the plugin has no persistent settings. */
	persistentSettings: JsonSchema.optional(),
	instanceSettings: z.partialRecord(Component, JsonSchema),
});
export type PluginInfo = z.infer<typeof PluginInfo>;

// `settings` is checked against the plugin's own schema by the server, which reports issues by path.
export const Slot = z.object({ plugin: z.string(), settings: z.unknown() });
export type Slot = z.infer<typeof Slot>;

export const AppletDefinition = z.object({
	inputs: z.array(Slot),
	modifiers: z.array(Slot),
	outputs: z.array(Slot),
});
export type AppletDefinition = z.infer<typeof AppletDefinition>;

/** The body of `POST /api/applets` and `PUT /api/applets/:id`. */
export const AppletDraft = z.object({
	name: z.string(),
	enabled: z.boolean(),
	definition: AppletDefinition,
});
export type AppletDraft = z.infer<typeof AppletDraft>;

/** ADR-0018 §1, as the UI shows it; the db's `Schedule` validates what is written. */
export const Schedule = z.object({
	kind: z.literal("interval"),
	unit: z.enum(["hour", "day", "week"]),
	count: z.int(),
	anchor: z.string(),
	timeZone: z.string(),
});
export type Schedule = z.infer<typeof Schedule>;

/** The most of each unit a schedule may step: a year, beyond which nobody syncs (ADR-0018 §1). */
export const MAX_SCHEDULE_COUNT = { hour: 8_760, day: 365, week: 52 } as const;

/** A refinement adding an issue at `count` when a schedule steps further than `MAX_SCHEDULE_COUNT`. */
export function checkScheduleCount(
	{ unit, count }: Pick<Schedule, "unit" | "count">,
	ctx: z.RefinementCtx,
): void {
	const most = MAX_SCHEDULE_COUNT[unit];
	if (count <= most) return;
	ctx.addIssue({
		code: "custom",
		path: ["count"],
		input: count,
		message: `At most ${most} ${unit}s: a schedule repeats at least once a year`,
	});
}

export const Applet = AppletDraft.extend({
	id: z.string(),
	schedule: Schedule.nullable(),
	hasWebhook: z.boolean(),
});
export type Applet = z.infer<typeof Applet>;

export const RunStatus = z.enum(["running", ...FinishedRunStatus.options]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunTrigger = z.enum([
	"schedule",
	"webhook",
	"manual",
] as const satisfies readonly StoredRunTrigger[]);
export type RunTrigger = z.infer<typeof RunTrigger>;

export const AppletListing = Applet.extend({
	state: z.enum(["idle", "running", "queued"]),
	lastRun: z.object({ id: z.string(), status: RunStatus, at: z.number() }).nullable(),
	/** Epoch milliseconds; null when nothing schedules the applet. */
	nextRunAt: z.number().nullable(),
});
export type AppletListing = z.infer<typeof AppletListing>;

/** Run now's answer: the run it started, or `queued` behind the applet's current run (ADR-0026 §5). */
export const RunNowResult = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("started"), runId: z.string() }),
	z.object({ kind: z.literal("queued") }),
]);
export type RunNowResult = z.infer<typeof RunNowResult>;

/** A freshly generated webhook, the only time its token is shown (ADR-0018 §5). */
export const WebhookUrl = z.object({ url: z.string() });
export type WebhookUrl = z.infer<typeof WebhookUrl>;

/** The inbound webhook's `202`: a run started, or one more queued behind the current run. */
export const WebhookFired = z.object({ status: z.enum(["started", "queued"]) });
export type WebhookFired = z.infer<typeof WebhookFired>;

export const RunSummary = z.object({
	id: z.string(),
	appletId: z.string(),
	trigger: RunTrigger,
	status: RunStatus,
	startedAt: z.number(),
	finishedAt: z.number().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const StoredSettings = z.object({
	/** The stored value, raw, even when it no longer parses (ADR-0019 §7). */
	value: z.unknown(),
	/** What the stored value fails today. */
	issues: z.array(ValidationIssue),
});
export type StoredSettings = z.infer<typeof StoredSettings>;

export const ServiceStatus = z.object({
	service: Service,
	flow: Flow,
	status: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("connected") }),
		z.object({ kind: z.literal("not-connected") }),
		z.object({ kind: z.literal("failed"), failure: AuthFailure }),
	]),
	/** Names of the plugins that declare this service. */
	usedBy: z.array(z.string()),
});
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const ServiceParams = z.object({ service: Service });

/** `GET /api/services/:service/redirect-uri`. */
export const RedirectUri = z.object({ redirectUri: z.string() });
export type RedirectUri = z.infer<typeof RedirectUri>;

/** `POST /api/services/:service/configure`: `200` when saved or the test failed, `422` invalid. */
export const ConfigureResult = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("saved") }),
	z.object({ kind: z.literal("invalid"), issues: z.array(ValidationIssue) }),
	z.object({ kind: z.literal("test-failed"), message: z.string() }),
]);
export type ConfigureResult = z.infer<typeof ConfigureResult>;

/** The body of `POST /api/services/:service/complete`: the query the OAuth return carried. */
export const OAuthCallback = z.record(z.string(), z.string());

export const ConnectOutcome = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("connected") }),
	z.object({ kind: z.literal("failed"), message: z.string() }),
]);
export type ConnectOutcome = z.infer<typeof ConnectOutcome>;

/** A body the route then checks against a plugin's or provider's own schema, with issues by path. */
export const JsonBody: z.ZodType<JsonValue> = z.json();
