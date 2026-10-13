CREATE TABLE `food_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`category` varchar(100) NOT NULL,
	`quantity` varchar(100) NOT NULL DEFAULT '1',
	`storage_location` enum('fridge','freezer','pantry') NOT NULL DEFAULT 'fridge',
	`food_image_url` text,
	`barcode` varchar(64),
	`expiry_date` timestamp NOT NULL,
	`added_date` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	`status` enum('fresh','expiring_soon','expired','consumed') NOT NULL DEFAULT 'fresh',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `food_inventory_id` PRIMARY KEY(`id`)
);
