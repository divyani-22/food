CREATE TABLE `qc_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`vendor` varchar(120) NOT NULL,
	`lot_id` varchar(80),
	`notes` text,
	`verdict` varchar(32) NOT NULL,
	`total` int NOT NULL,
	`grade_a` int NOT NULL DEFAULT 0,
	`grade_b` int NOT NULL DEFAULT 0,
	`grade_review` int NOT NULL DEFAULT 0,
	`grade_reject` int NOT NULL DEFAULT 0,
	`mean_p_fresh` float NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qc_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qc_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`label` varchar(160),
	`fruit_type` varchar(64) NOT NULL,
	`freshness` enum('fresh','normal','rotten') NOT NULL,
	`p_fresh` float NOT NULL,
	`confidence` float NOT NULL,
	`grade` varchar(8) NOT NULL,
	`reasons` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qc_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_link_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`code_hash` varchar(64) NOT NULL,
	`salt` varchar(32) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used_at` timestamp,
	`attempts` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsapp_link_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'UTC',
	`reminder_hour` int NOT NULL DEFAULT 9,
	`reminders_enabled` boolean NOT NULL DEFAULT true,
	`last_inbound_at` timestamp,
	`last_reminder_local_date` varchar(10),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsapp_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_links_user_id_unique` UNIQUE(`user_id`),
	CONSTRAINT `whatsapp_links_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_seen` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(16) NOT NULL,
	`message_id` varchar(128) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsapp_seen_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_seen_provider_message_unique` UNIQUE(`provider`,`message_id`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`state` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsapp_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_state_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
ALTER TABLE `alternatives` ADD `brand` varchar(255);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `region` varchar(64);--> statement-breakpoint
ALTER TABLE `qc_items` ADD CONSTRAINT `qc_items_batch_id_qc_batches_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `qc_batches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `qc_batches_user_id_idx` ON `qc_batches` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `qc_items_batch_id_idx` ON `qc_items` (`batch_id`);--> statement-breakpoint
CREATE INDEX `whatsapp_link_codes_user_id_idx` ON `whatsapp_link_codes` (`user_id`);