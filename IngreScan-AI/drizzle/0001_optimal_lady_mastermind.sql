CREATE TABLE `alternatives` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scan_id` int NOT NULL,
	`product_name` varchar(255) NOT NULL,
	`reason` text NOT NULL,
	`scientific_justification` text,
	`sources` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alternatives_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`scan_id` int,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `food_scans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_name` varchar(255),
	`input_type` enum('text','image') NOT NULL,
	`image_url` text,
	`image_key` text,
	`raw_ingredients` text,
	`ocr_text` text,
	`risk_score` int,
	`analysis_complete` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `food_scans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ingredient_database` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`scientific_name` varchar(255),
	`category` varchar(100),
	`description` text,
	`health_impact` text,
	`regulatory_status` text,
	`fssai_data` text,
	`who_data` text,
	`sources` text,
	`last_updated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ingredient_database_id` PRIMARY KEY(`id`),
	CONSTRAINT `ingredient_database_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `medical_conditions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`condition` text NOT NULL,
	`diagnosed_date` timestamp,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `medical_conditions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `medications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`dosage` varchar(100),
	`frequency` varchar(100),
	`start_date` timestamp,
	`end_date` timestamp,
	`is_current` boolean NOT NULL DEFAULT true,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `medications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scan_ingredients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scan_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`scientific_name` varchar(255),
	`category` varchar(100),
	`risk_level` enum('safe','low','moderate','high','severe'),
	`short_term_effects` text,
	`long_term_effects` text,
	`side_effects` text,
	`personalized_risk` text,
	`sources` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scan_ingredients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`age` int,
	`gender` enum('male','female','other'),
	`height` int,
	`weight` int,
	`bmi` float,
	`exercise_frequency` enum('sedentary','light','moderate','active','very_active'),
	`diet_type` enum('veg','non_veg','vegan','keto','other'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_id` PRIMARY KEY(`id`)
);
