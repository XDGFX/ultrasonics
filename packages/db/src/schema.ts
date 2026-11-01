import { blob, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import type { AppletDefinition } from "./applet-definition.ts";
import type { JsonValue } from "./json.ts";
import type { Schedule } from "./schedule.ts";

export const RUN_TRIGGERS = ["schedule", "webhook", "manual"] as const;
export const RUN_STATUSES = ["running", "succeeded", "partial", "failed", "interrupted"] as const;

export const accounts = sqliteTable("accounts", {
	id: text("id").primaryKey(),
	createdAt: integer("created_at").notNull(),
});

const accountId = () =>
	text("account_id")
		.notNull()
		.references(() => accounts.id);

export const sessions = sqliteTable("sessions", {
	id: text("id").primaryKey(),
	accountId: accountId(),
	tokenHash: text("token_hash").notNull().unique(),
	createdAt: integer("created_at").notNull(),
	authenticatedAt: integer("authenticated_at").notNull(),
	lastSeenAt: integer("last_seen_at").notNull(),
	expiresAt: integer("expires_at").notNull(),
});

export const federatedIdentities = sqliteTable(
	"federated_identities",
	{
		id: text("id").primaryKey(),
		accountId: accountId(),
		provider: text("provider").notNull(),
		subjectId: text("subject_id").notNull(),
		email: text("email"),
	},
	(table) => [
		unique().on(table.provider, table.subjectId),
		index("federated_identities_email_idx").on(table.email),
	],
);

export const applets = sqliteTable(
	"applets",
	{
		id: text("id").primaryKey(),
		accountId: accountId(),
		name: text("name").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull(),
		definition: text("definition", { mode: "json" }).$type<AppletDefinition>().notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
		schedule: text("schedule", { mode: "json" }).$type<Schedule>(),
		nextRunAt: integer("next_run_at"),
		webhookTokenHash: text("webhook_token_hash").unique(),
	},
	(table) => [index("applets_next_run_at_idx").on(table.nextRunAt)],
);

export const credentials = sqliteTable(
	"credentials",
	{
		accountId: accountId(),
		service: text("service").notNull(),
		expiresAt: integer("expires_at"),
		keyVersion: integer("key_version").notNull(),
		secret: blob("secret", { mode: "buffer" }).notNull(),
	},
	(table) => [unique().on(table.accountId, table.service)],
);

export const pluginSettings = sqliteTable(
	"plugin_settings",
	{
		accountId: accountId(),
		plugin: text("plugin").notNull(),
		value: text("value", { mode: "json" }).$type<JsonValue>().notNull(),
	},
	(table) => [unique().on(table.accountId, table.plugin)],
);

export const instanceSettings = sqliteTable("instance_settings", {
	key: text("key").primaryKey(),
	value: text("value", { mode: "json" }).$type<JsonValue>().notNull(),
});

export const runs = sqliteTable("runs", {
	id: text("id").primaryKey(),
	accountId: accountId(),
	appletId: text("applet_id")
		.notNull()
		.references(() => applets.id, { onDelete: "cascade" }),
	trigger: text("trigger", { enum: RUN_TRIGGERS }).notNull(),
	status: text("status", { enum: RUN_STATUSES }).notNull(),
	startedAt: integer("started_at").notNull(),
	finishedAt: integer("finished_at"),
	log: text("log", { mode: "json" }).$type<JsonValue>(),
	stages: text("stages", { mode: "json" }).$type<JsonValue>(),
	results: text("results", { mode: "json" }).$type<JsonValue>(),
});
