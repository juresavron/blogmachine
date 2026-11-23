CREATE TABLE `repository_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connector_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operation_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`site_id` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_post_site` ON `publications` (`post_id`,`site_id`);--> statement-breakpoint
CREATE TABLE `connector_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`data` text NOT NULL,
	`expires_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
