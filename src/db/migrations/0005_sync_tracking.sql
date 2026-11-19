CREATE TABLE `dedupe_exceptions` (
	`id_a` text NOT NULL,
	`id_b` text NOT NULL,
	`at` integer NOT NULL,
	`sync_dirty` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`id_a`, `id_b`)
);
--> statement-breakpoint
CREATE TABLE `row_history` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`id` text NOT NULL,
	`row_json` text NOT NULL,
	`cause` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `tombstones` (
	`entity` text NOT NULL,
	`id` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`reason` text NOT NULL,
	`merged_into` text,
	`device` text NOT NULL,
	`sync_dirty` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`entity`, `id`)
);
--> statement-breakpoint
ALTER TABLE `budgets` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `budgets` ADD `sync_dirty` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `categories` ADD `sync_dirty` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `created_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `created_device` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `first_synced_at` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `sync_dirty` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `transactions_dup_idx` ON `transactions` (`category_id`,`amount_minor`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_sync_dirty_idx` ON `transactions` (`sync_dirty`) WHERE "transactions"."sync_dirty" = 1;--> statement-breakpoint
-- Backfill (hand-written). Rows that exist before sync count as entered and
-- edited at migration time. created_device stays 'legacy', which keeps them
-- out of duplicate detection: pre-sync data can't have come from two devices.
UPDATE `transactions` SET `created_at` = CAST(strftime('%s', 'now') AS integer) * 1000, `updated_at` = CAST(strftime('%s', 'now') AS integer) * 1000;--> statement-breakpoint
UPDATE `budgets` SET `updated_at` = CAST(strftime('%s', 'now') AS integer) * 1000;--> statement-breakpoint
-- Seeded defaults keep updated_at = 0: identical on every device, so they never
-- conflict, and any real edit (> 0) beats them.
UPDATE `categories` SET `updated_at` = CAST(strftime('%s', 'now') AS integer) * 1000 WHERE `is_default` = 0;
