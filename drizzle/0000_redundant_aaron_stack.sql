CREATE TABLE `governance_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace` text NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_seen` text
);
--> statement-breakpoint
CREATE TABLE `governance_ledger` (
	`workspace` text NOT NULL,
	`sequence` integer NOT NULL,
	`entry` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`workspace`, `sequence`)
);
--> statement-breakpoint
CREATE TABLE `governance_records` (
	`workspace` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`workspace`, `kind`, `id`)
);
--> statement-breakpoint
CREATE TABLE `governance_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`head` text DEFAULT '' NOT NULL,
	`mutation` text DEFAULT '' NOT NULL,
	`private_key` text NOT NULL,
	`public_key` text NOT NULL,
	`created_at` text NOT NULL
);
