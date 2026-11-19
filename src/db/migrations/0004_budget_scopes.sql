-- Budgets move from one row per (category, month) to one row per *scope*: a
-- start month and an optional end month (null = every month from the start).
-- Every existing budget becomes a one-month budget for the month it was set
-- in, so nothing anyone already sees changes. created_at is filled with the
-- migration time; it only breaks ties between otherwise equal budgets.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text,
	`limit_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_budgets`("id", "category_id", "start_month", "end_month", "limit_minor", "created_at")
SELECT 'b-' || lower(hex(randomblob(8))), "category_id", "month", "month", "limit_minor", CAST(strftime('%s', 'now') AS integer) * 1000 FROM `budgets`;--> statement-breakpoint
DROP TABLE `budgets`;--> statement-breakpoint
ALTER TABLE `__new_budgets` RENAME TO `budgets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `budgets_category_id_idx` ON `budgets` (`category_id`);
