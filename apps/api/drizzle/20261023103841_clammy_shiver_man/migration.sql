CREATE TABLE IF NOT EXISTS `app_settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `categories` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`color` text NOT NULL,
	CONSTRAINT "categories_type_check" CHECK("type" IN ('INCOME', 'EXPENSE'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transactions` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`date` text NOT NULL,
	`category_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_transactions_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`),
	CONSTRAINT "transactions_amount_check" CHECK("amount" <> 0),
	CONSTRAINT "transactions_currency_check" CHECK("currency" IN ('USD'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `categories_type_name_idx` ON `categories` (`type`,lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transactions_category_date_idx` ON `transactions` (`category_id`,`date`);