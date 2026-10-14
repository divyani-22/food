CREATE TABLE `produce_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`fruit_type` varchar(64) NOT NULL,
	`freshness` enum('fresh','normal','rotten') NOT NULL,
	`p_fresh` float NOT NULL,
	`confidence` float NOT NULL,
	`image_url` varchar(512),
	`expiry_date` varchar(10) NOT NULL,
	`storage_tip` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `produce_inventory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `produce_scans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`fruit_type` varchar(64) NOT NULL,
	`fruit_name` varchar(100) NOT NULL,
	`freshness` enum('fresh','normal','rotten') NOT NULL,
	`freshness_label` varchar(64) NOT NULL,
	`p_fresh` float NOT NULL,
	`confidence` float NOT NULL,
	`image_url` varchar(512),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `produce_scans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `produce_inventory_user_id_idx` ON `produce_inventory` (`user_id`);--> statement-breakpoint
CREATE INDEX `produce_scans_user_id_idx` ON `produce_scans` (`user_id`,`created_at`);