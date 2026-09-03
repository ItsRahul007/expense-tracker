import type { ID } from "@/types/domain";

/**
 * The id for a newly created category: a slug of its name, with a numeric
 * suffix if that slug is already taken.
 *
 * The suffix isn't paranoia — two different names can slug to the same string
 * ("Pet care" vs "Pet-care"), and since the id is the primary key, a collision
 * would overwrite the first category rather than add a second.
 *
 * Shared by the category editor and the CSV import so a category created by
 * hand and one created by a file are indistinguishable afterwards. Callers pass
 * every id already in play, including ones they're about to insert in the same
 * batch, which is why this takes a set of ids rather than reading the database.
 */
export function makeCategoryId(name: string, taken: ReadonlySet<ID>): ID {
  const base = `c-${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

  // A name of nothing but punctuation slugs to the bare prefix, which is a
  // legal-but-meaningless id; the editor's own validation blocks it, the
  // importer's fallback below covers it.
  const stem = base === "c-" ? "c-category" : base;

  if (!taken.has(stem)) return stem;
  let suffix = 2;
  while (taken.has(`${stem}-${suffix}`)) suffix++;
  return `${stem}-${suffix}`;
}
