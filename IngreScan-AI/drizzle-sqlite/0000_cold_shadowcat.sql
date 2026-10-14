CREATE TABLE `alternatives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer NOT NULL,
	`product_name` text(255) NOT NULL,
	`reason` text NOT NULL,
	`scientific_justification` text,
	`sources` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `food_scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alternatives_scan_id_idx` ON `alternatives` (`scan_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`scan_id` integer,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `food_scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_user_id_idx` ON `chat_messages` (`user_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_scan_id_idx` ON `chat_messages` (`scan_id`);--> statement-breakpoint
CREATE TABLE `food_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text(255) NOT NULL,
	`category` text(100) NOT NULL,
	`quantity` text(100) DEFAULT '1' NOT NULL,
	`storage_location` text DEFAULT 'fridge' NOT NULL,
	`food_image_url` text,
	`barcode` text(64),
	`expiry_date` integer NOT NULL,
	`added_date` integer DEFAULT (unixepoch()) NOT NULL,
	`notes` text,
	`status` text DEFAULT 'fresh' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `food_inventory_user_id_idx` ON `food_inventory` (`user_id`);--> statement-breakpoint
CREATE TABLE `food_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`product_name` text(255),
	`input_type` text NOT NULL,
	`image_url` text,
	`image_key` text,
	`raw_ingredients` text,
	`ocr_text` text,
	`risk_score` integer,
	`analysis_complete` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `food_scans_user_id_idx` ON `food_scans` (`user_id`);--> statement-breakpoint
CREATE TABLE `ingredient_database` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text(255) NOT NULL,
	`scientific_name` text(255),
	`category` text(100),
	`description` text,
	`health_impact` text,
	`regulatory_status` text,
	`fssai_data` text,
	`who_data` text,
	`sources` text,
	`last_updated` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_database_name_unique` ON `ingredient_database` (`name`);--> statement-breakpoint
CREATE TABLE `medical_conditions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`condition` text NOT NULL,
	`diagnosed_date` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `medical_conditions_user_id_idx` ON `medical_conditions` (`user_id`);--> statement-breakpoint
CREATE TABLE `medications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text(255) NOT NULL,
	`dosage` text(100),
	`frequency` text(100),
	`start_date` integer,
	`end_date` integer,
	`is_current` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `medications_user_id_idx` ON `medications` (`user_id`);--> statement-breakpoint
CREATE TABLE `produce_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text(100) NOT NULL,
	`fruit_type` text(64) NOT NULL,
	`freshness` text NOT NULL,
	`p_fresh` real NOT NULL,
	`confidence` real NOT NULL,
	`image_url` text(512),
	`expiry_date` text(10) NOT NULL,
	`storage_tip` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `produce_inventory_user_id_idx` ON `produce_inventory` (`user_id`);--> statement-breakpoint
CREATE TABLE `produce_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`fruit_type` text(64) NOT NULL,
	`fruit_name` text(100) NOT NULL,
	`freshness` text NOT NULL,
	`freshness_label` text(64) NOT NULL,
	`p_fresh` real NOT NULL,
	`confidence` real NOT NULL,
	`image_url` text(512),
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `produce_scans_user_id_idx` ON `produce_scans` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `scan_ingredients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` integer NOT NULL,
	`name` text(255) NOT NULL,
	`scientific_name` text(255),
	`category` text(100),
	`risk_level` text,
	`short_term_effects` text,
	`long_term_effects` text,
	`side_effects` text,
	`personalized_risk` text,
	`sources` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `food_scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_ingredients_scan_id_idx` ON `scan_ingredients` (`scan_id`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`age` integer,
	`gender` text,
	`height` integer,
	`weight` integer,
	`bmi` real,
	`exercise_frequency` text,
	`diet_type` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_user_id_unique` ON `user_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`openId` text(64) NOT NULL,
	`name` text,
	`email` text(320),
	`loginMethod` text(64),
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastSignedIn` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_openId_unique` ON `users` (`openId`);