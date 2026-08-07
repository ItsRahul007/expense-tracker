-- Custom SQL migration file, put your code below! --
-- Seeds the default category set. Runs once, ever — Drizzle tracks applied
-- migrations, so deleting these later (categories are user-owned data) is
-- permanent and nothing re-inserts them on a later boot.
INSERT INTO `categories` (`id`, `name`, `icon`, `color`, `sort_order`) VALUES
	('c-food', 'Food & Drink', 'restaurant', '#F97316', 0),
	('c-groc', 'Groceries', 'cart', '#10B981', 1),
	('c-trvl', 'Transport', 'car', '#3B82F6', 2),
	('c-home', 'Rent & Bills', 'receipt', '#8B5CF6', 3),
	('c-hlth', 'Health', 'fitness', '#EC4899', 4),
	('c-shop', 'Shopping', 'bag-handle', '#F59E0B', 5),
	('c-entm', 'Entertainment', 'game-controller', '#06B6D4', 6),
	('c-misc', 'Other', 'ellipsis-horizontal', '#6B7280', 7);
