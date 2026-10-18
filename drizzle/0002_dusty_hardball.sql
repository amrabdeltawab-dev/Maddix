ALTER TABLE `materials` ADD `packagingType` enum('CARTON','BAG','JERRY_CAN') DEFAULT 'CARTON' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `packagingTypeSnapshot` enum('CARTON','BAG','JERRY_CAN') DEFAULT 'CARTON' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `status` enum('PENDING','PREPARING','PREPARED') DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `startedAt` timestamp;--> statement-breakpoint
ALTER TABLE `order_items` ADD `startedBy` int;--> statement-breakpoint
ALTER TABLE `order_items` ADD `preparedAt` timestamp;--> statement-breakpoint
ALTER TABLE `order_items` ADD `preparedBy` int;--> statement-breakpoint
ALTER TABLE `order_items` ADD `createdAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;