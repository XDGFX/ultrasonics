CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `applets` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer NOT NULL,
	`definition` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`schedule` text,
	`next_run_at` integer,
	`webhook_token_hash` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applets_webhook_token_hash_unique` ON `applets` (`webhook_token_hash`);--> statement-breakpoint
CREATE INDEX `applets_next_run_at_idx` ON `applets` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`account_id` text NOT NULL,
	`service` text NOT NULL,
	`expires_at` integer,
	`key_version` integer NOT NULL,
	`secret` blob NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_account_id_service_unique` ON `credentials` (`account_id`,`service`);--> statement-breakpoint
CREATE TABLE `federated_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject_id` text NOT NULL,
	`email` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `federated_identities_email_idx` ON `federated_identities` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `federated_identities_provider_subject_id_unique` ON `federated_identities` (`provider`,`subject_id`);--> statement-breakpoint
CREATE TABLE `instance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugin_settings` (
	`account_id` text NOT NULL,
	`plugin` text NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_settings_account_id_plugin_unique` ON `plugin_settings` (`account_id`,`plugin`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`applet_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`log` text,
	`stages` text,
	`results` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applet_id`) REFERENCES `applets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`authenticated_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);