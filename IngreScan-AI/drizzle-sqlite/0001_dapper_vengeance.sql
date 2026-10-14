CREATE TABLE `qc_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`vendor` text(120) NOT NULL,
	`lot_id` text(80),
	`notes` text,
	`verdict` text(32) NOT NULL,
	`total` integer NOT NULL,
	`grade_a` integer DEFAULT 0 NOT NULL,
	`grade_b` integer DEFAULT 0 NOT NULL,
	`grade_review` integer DEFAULT 0 NOT NULL,
	`grade_reject` integer DEFAULT 0 NOT NULL,
	`mean_p_fresh` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `qc_batches_user_id_idx` ON `qc_batches` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `qc_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`label` text(160),
	`fruit_type` text(64) NOT NULL,
	`freshness` text NOT NULL,
	`p_fresh` real NOT NULL,
	`confidence` real NOT NULL,
	`grade` text(8) NOT NULL,
	`reasons` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `qc_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `qc_items_batch_id_idx` ON `qc_items` (`batch_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_link_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`code_hash` text(64) NOT NULL,
	`salt` text(32) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `whatsapp_link_codes_user_id_idx` ON `whatsapp_link_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`phone` text(20) NOT NULL,
	`timezone` text(64) DEFAULT 'UTC' NOT NULL,
	`reminder_hour` integer DEFAULT 9 NOT NULL,
	`reminders_enabled` integer DEFAULT true NOT NULL,
	`last_inbound_at` integer,
	`last_reminder_local_date` text(10),
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_links_user_id_unique` ON `whatsapp_links` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_links_phone_unique` ON `whatsapp_links` (`phone`);--> statement-breakpoint
CREATE TABLE `whatsapp_seen` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text(16) NOT NULL,
	`message_id` text(128) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_seen_provider_message_unique` ON `whatsapp_seen` (`provider`,`message_id`);--> statement-breakpoint
CREATE TABLE `whatsapp_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`phone` text(20) NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `whatsapp_state_phone_unique` ON `whatsapp_state` (`phone`);--> statement-breakpoint
ALTER TABLE `alternatives` ADD `brand` text(255);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `region` text(64);