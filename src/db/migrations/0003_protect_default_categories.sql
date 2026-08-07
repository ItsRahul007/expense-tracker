-- Custom SQL migration file, put your code below! --
-- Marks the 8 seeded categories from 0001_seed_default_categories.sql as
-- default, and installs a trigger that blocks deleting them — enforced by
-- SQLite itself, so it holds even for a row deleted directly in Drizzle
-- Studio, not just through app code that happens to check first.
UPDATE `categories` SET `is_default` = 1 WHERE `id` IN (
	'c-food', 'c-groc', 'c-trvl', 'c-home', 'c-hlth', 'c-shop', 'c-entm', 'c-misc'
);
--> statement-breakpoint
CREATE TRIGGER `categories_protect_default_delete`
BEFORE DELETE ON `categories`
WHEN OLD.`is_default` = 1
BEGIN
	SELECT RAISE(ABORT, 'Cannot delete a default category');
END;