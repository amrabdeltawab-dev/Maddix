CREATE TABLE `admin_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminId` int NOT NULL,
	`action` varchar(96) NOT NULL,
	`targetType` varchar(48) NOT NULL,
	`targetId` varchar(96) NOT NULL,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `materials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`normalizedName` varchar(160) NOT NULL,
	`unit` varchar(40) NOT NULL,
	`description` text,
	`category` varchar(80) NOT NULL DEFAULT 'مواد أخرى',
	`allowDecimal` int NOT NULL DEFAULT 0,
	`active` int NOT NULL DEFAULT 1,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `materials_id` PRIMARY KEY(`id`),
	CONSTRAINT `materials_name_unit_idx` UNIQUE(`normalizedName`,`unit`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recipientId` int NOT NULL,
	`type` varchar(48) NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`orderId` int,
	`read` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`materialId` int NOT NULL,
	`materialNameSnapshot` varchar(160) NOT NULL,
	`unitSnapshot` varchar(40) NOT NULL,
	`quantity` int NOT NULL,
	`quantityDecimal` varchar(32),
	`allowDecimalSnapshot` int NOT NULL DEFAULT 0,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_status_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`oldStatus` varchar(32),
	`newStatus` varchar(32) NOT NULL,
	`changedBy` int NOT NULL,
	`note` text,
	`changedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_status_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderNumber` varchar(32) NOT NULL,
	`userId` int NOT NULL,
	`userNameSnapshot` varchar(160) NOT NULL,
	`status` enum('NEW','PROCESSING','READY','DELIVERED','REJECTED') NOT NULL DEFAULT 'NEW',
	`notes` text,
	`totalItems` int NOT NULL DEFAULT 0,
	`idempotencyKey` varchar(96) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastStatusChangedAt` timestamp,
	`lastStatusChangedBy` int,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_orderNumber_unique` UNIQUE(`orderNumber`),
	CONSTRAINT `orders_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `username` varchar(80);--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `active` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_username_unique` UNIQUE(`username`);--> statement-breakpoint
CREATE INDEX `admin_logs_admin_idx` ON `admin_logs` (`adminId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `materials_active_idx` ON `materials` (`active`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipientId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`orderId`);--> statement-breakpoint
CREATE INDEX `order_status_history_order_idx` ON `order_status_history` (`orderId`,`changedAt`);--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`,`createdAt`);