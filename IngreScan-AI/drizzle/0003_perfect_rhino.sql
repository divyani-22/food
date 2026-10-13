-- Clean existing data so the new constraints can be applied.
DELETE p1 FROM `user_profiles` p1 INNER JOIN `user_profiles` p2 ON p1.`user_id` = p2.`user_id` AND p1.`id` < p2.`id`;--> statement-breakpoint
DELETE FROM `scan_ingredients` WHERE `scan_id` NOT IN (SELECT `id` FROM `food_scans`);--> statement-breakpoint
DELETE FROM `alternatives` WHERE `scan_id` NOT IN (SELECT `id` FROM `food_scans`);--> statement-breakpoint
ALTER TABLE `user_profiles` ADD CONSTRAINT `user_profiles_user_id_unique` UNIQUE(`user_id`);--> statement-breakpoint
ALTER TABLE `alternatives` ADD CONSTRAINT `alternatives_scan_id_food_scans_id_fk` FOREIGN KEY (`scan_id`) REFERENCES `food_scans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scan_ingredients` ADD CONSTRAINT `scan_ingredients_scan_id_food_scans_id_fk` FOREIGN KEY (`scan_id`) REFERENCES `food_scans`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `alternatives_scan_id_idx` ON `alternatives` (`scan_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_user_id_idx` ON `chat_messages` (`user_id`);--> statement-breakpoint
CREATE INDEX `chat_messages_scan_id_idx` ON `chat_messages` (`scan_id`);--> statement-breakpoint
CREATE INDEX `food_inventory_user_id_idx` ON `food_inventory` (`user_id`);--> statement-breakpoint
CREATE INDEX `food_scans_user_id_idx` ON `food_scans` (`user_id`);--> statement-breakpoint
CREATE INDEX `medical_conditions_user_id_idx` ON `medical_conditions` (`user_id`);--> statement-breakpoint
CREATE INDEX `medications_user_id_idx` ON `medications` (`user_id`);--> statement-breakpoint
CREATE INDEX `scan_ingredients_scan_id_idx` ON `scan_ingredients` (`scan_id`);