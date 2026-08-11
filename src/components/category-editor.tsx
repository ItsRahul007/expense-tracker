import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Button, Card, Chip, IconBadge } from "@/components/ui";
import {
  CATEGORY_COLORS,
  CATEGORY_EMOJI,
  CATEGORY_ICONS,
} from "@/constants/category-options";
import { usePalette } from "@/constants/palette";
import { isEmojiIcon, isSingleEmoji } from "@/lib/emoji";
import { useCategories, useUpsertCategory } from "@/queries";
import type { Category, ID } from "@/types/domain";

/**
 * Create or edit a custom category: name, icon, colour.
 *
 * The icon is either an Ionicons glyph from `CATEGORY_ICONS` or an emoji — from
 * the grid or typed into the field — and both are stored in the same `icon`
 * column. See `src/lib/emoji.ts` for why that needs no discriminator.
 *
 * Shared between the Categories screen and the inline "New category" step in the
 * add-expense and add-budget sheets, so every entry point offers exactly the same
 * options and generates ids the same way.
 *
 * Pass `category` to edit an existing one instead of creating. Edit mode reuses
 * the same form deliberately — a separate one would drift, and `useUpsertCategory`
 * already treats a known id as an update.
 *
 * `onCreated` receives the new id so the add flows can select the category
 * immediately — creating one and then having to hunt for it in the grid would
 * make the shortcut pointless.
 */
export function CategoryEditor({
  category,
  onCreated,
  onSaved,
  onCancel,
  onDelete,
  deleteBlockedReason,
  autoFocus = false,
}: {
  category?: Category;
  onCreated?: (id: ID) => void;
  onSaved?: () => void;
  onCancel?: () => void;
  /** Edit mode only. Omit to leave the delete action off entirely. */
  onDelete?: () => void;
  /** When set, delete is disabled and this is shown as the reason. */
  deleteBlockedReason?: string | null;
  autoFocus?: boolean;
}) {
  const palette = usePalette();
  const { data: categories } = useCategories();
  const upsertCategory = useUpsertCategory();

  const editing = category !== undefined;

  // Seeded from props on mount only. Callers editing a different category are
  // expected to remount (see the `key` on the Categories screen), which is what
  // keeps a refetch from overwriting a half-typed name.
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]);

  /**
   * An icon is either an Ionicons glyph or an emoji, and the two are kept in
   * separate state rather than one `icon` value so that toggling between the tabs
   * to compare them doesn't throw the other choice away. `icon` below is whichever
   * the active tab points at — that's the single value that gets saved.
   */
  const startedAsEmoji = category !== undefined && isEmojiIcon(category.icon);
  const [mode, setMode] = useState<"icon" | "emoji">(
    startedAsEmoji ? "emoji" : "icon",
  );
  const [glyph, setGlyph] = useState(
    category && !startedAsEmoji ? category.icon : CATEGORY_ICONS[0],
  );
  const [emoji, setEmoji] = useState(
    startedAsEmoji ? category.icon : CATEGORY_EMOJI[0],
  );
  /** The free-entry field, for an emoji that isn't in the grid. */
  const [typed, setTyped] = useState(
    startedAsEmoji && !CATEGORY_EMOJI.includes(category.icon)
      ? category.icon
      : "",
  );

  const icon = mode === "emoji" ? emoji : glyph;
  /** Shown only once something's been typed — an empty field isn't an error. */
  const typedIsInvalid = typed.length > 0 && !isSingleEmoji(typed);

  const trimmed = name.trim();
  const existing = categories ?? [];
  const duplicate = existing.some(
    (c) =>
      c.name.toLowerCase() === trimmed.toLowerCase() && c.id !== category?.id,
  );
  const changed =
    category === undefined ||
    trimmed !== category.name ||
    icon !== category.icon ||
    color !== category.color;
  // Blocked while the emoji field holds something unusable, so the error under it
  // is worth acting on rather than something to save straight past.
  const canSubmit =
    trimmed.length > 0 && !duplicate && changed && !typedIsInvalid;

  /** Slug from the name, with a numeric suffix if that slug is taken — two
   *  categories can share a slug even when the names differ ("Pet care" vs
   *  "Pet-care"), and a colliding primary key would overwrite the first. */
  const makeId = (): ID => {
    const base = `c-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    if (!existing.some((c) => c.id === base)) return base;
    let suffix = 2;
    while (existing.some((c) => c.id === `${base}-${suffix}`)) suffix++;
    return `${base}-${suffix}`;
  };

  const submit = () => {
    if (!canSubmit) return;

    // The id and sortOrder are kept: renaming "Food" to "Groceries" is the same
    // category, and re-slugging it would orphan every expense pointing at it.
    if (category) {
      upsertCategory.mutate({ ...category, name: trimmed, icon, color });
      onSaved?.();
      return;
    }

    const id = makeId();
    upsertCategory.mutate({
      id,
      name: trimmed,
      icon,
      color,
      sortOrder: existing.length + 1,
    });
    // The tab is left where it is — the Categories screen keeps this form mounted
    // for repeated creates, and someone who just picked an emoji is likely to want
    // the emoji grid again for the next one.
    setName("");
    setGlyph(CATEGORY_ICONS[0]);
    setEmoji(CATEGORY_EMOJI[0]);
    setTyped("");
    setColor(CATEGORY_COLORS[0]);
    onCreated?.(id);
  };

  const chooseMode = (next: "icon" | "emoji") => {
    setMode(next);
    // Leaving the emoji tab drops a half-typed value, so a stale error can't
    // outlive the field it belongs to and block saving.
    if (next === "icon") setTyped("");
  };

  const typeEmoji = (next: string) => {
    setTyped(next);
    // Applied as soon as it's a single emoji, so the preview badge tracks the
    // field. Anything else leaves the last good choice in place.
    if (isSingleEmoji(next)) setEmoji(next);
  };

  return (
    <Card>
      <View className="flex-row items-center gap-3">
        {/* Live preview — the badge is the thing being configured, so it should
            react to the icon and colour choices as they're made. */}
        <IconBadge icon={icon} color={color} size="lg" />
        <TextInput
          autoFocus={autoFocus}
          value={name}
          onChangeText={setName}
          placeholder="Category name"
          placeholderTextColor={palette.muted}
          returnKeyType="done"
          onSubmitEditing={submit}
          className="font-sans-medium h-12 flex-1 rounded-xl border border-border bg-bg px-3 text-body text-fg"
          style={{ minWidth: 0 }}
          accessibilityLabel="Category name"
        />
      </View>

      {duplicate ? (
        <Text className="font-sans mt-2 text-label text-danger">
          You already have a category called “{trimmed}”.
        </Text>
      ) : null}

      <View className="mb-2 mt-5 flex-row items-center justify-between">
        <Text className="font-sans-medium text-label text-muted">Icon</Text>
        <View className="flex-row gap-2">
          <Chip
            label="Icons"
            selected={mode === "icon"}
            onPress={() => chooseMode("icon")}
          />
          <Chip
            label="Emoji"
            selected={mode === "emoji"}
            onPress={() => chooseMode("emoji")}
          />
        </View>
      </View>

      {mode === "icon" ? (
        <View className="flex-row flex-wrap gap-2">
          {CATEGORY_ICONS.map((choice) => (
            <Pressable
              key={choice}
              onPress={() => setGlyph(choice)}
              accessibilityRole="button"
              accessibilityLabel={`Icon ${choice}`}
              accessibilityState={{ selected: glyph === choice }}
              className={`h-11 w-11 items-center justify-center rounded-xl border ${
                glyph === choice ? "border-accent bg-accent/10" : "border-border bg-bg"
              } active:opacity-60`}
            >
              <Ionicons
                name={choice as never}
                size={19}
                color={glyph === choice ? palette.accent : palette.muted}
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <View className="flex-row flex-wrap gap-2">
            {CATEGORY_EMOJI.map((choice) => (
              <Pressable
                key={choice}
                onPress={() => {
                  setEmoji(choice);
                  // Clear the field, so it can't sit there showing something
                  // different from what's actually selected.
                  setTyped("");
                }}
                accessibilityRole="button"
                accessibilityLabel={`Emoji ${choice}`}
                accessibilityState={{ selected: emoji === choice }}
                className={`h-11 w-11 items-center justify-center rounded-xl border ${
                  emoji === choice ? "border-accent bg-accent/10" : "border-border bg-bg"
                } active:opacity-60`}
              >
                {/* No font class — emoji need the system emoji font, and an
                    explicit lineHeight keeps Android from clipping them. */}
                <Text style={{ fontSize: 20, lineHeight: 24, includeFontPadding: false }}>
                  {choice}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* The grid can't hold every emoji, and the one someone wants for
              "Chai" or "Cricket" is exactly the one that isn't in it. */}
          <TextInput
            value={typed}
            onChangeText={typeEmoji}
            placeholder="Or type any emoji"
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            // Long enough for a joined sequence like a family emoji, short enough
            // that a pasted sentence can't get in.
            maxLength={16}
            className="font-sans-medium mt-3 h-12 rounded-xl border border-border bg-bg px-3 text-body text-fg"
            accessibilityLabel="Type an emoji"
          />
          {typedIsInvalid ? (
            <Text className="font-sans mt-2 text-label text-danger">
              That isn’t a single emoji — try 🍔 or 🎉.
            </Text>
          ) : null}
        </>
      )}

      <Text className="font-sans-medium mb-2 mt-5 text-label text-muted">Colour</Text>
      <View className="flex-row flex-wrap gap-2.5">
        {CATEGORY_COLORS.map((choice) => (
          <Pressable
            key={choice}
            onPress={() => setColor(choice)}
            accessibilityRole="button"
            accessibilityLabel={`Colour ${choice}`}
            accessibilityState={{ selected: color === choice }}
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
            // Object style, not a function: NativeWind drops function-form
            // `style` when `className` is also present, which left every swatch
            // with no background at all.
            style={{ backgroundColor: choice }}
          >
            {color === choice ? (
              <Ionicons name="checkmark" size={18} color="#FFFFFF" />
            ) : null}
          </Pressable>
        ))}
      </View>
      {mode === "emoji" ? (
        // Otherwise picking a colour and watching the emoji ignore it reads as a
        // bug. The colour still matters — it tints the badge here and the progress
        // bars on the budgets and stats screens.
        <Text className="font-sans mt-2 text-caption text-muted">
          Emoji keep their own colours — this tints the circle behind it.
        </Text>
      ) : null}

      <View className="mt-6 gap-3">
        <Button
          label={editing ? "Save changes" : "Create category"}
          onPress={submit}
          disabled={!canSubmit}
        />
        {onCancel ? (
          <Button label="Cancel" variant="secondary" onPress={onCancel} />
        ) : null}
      </View>

      {/* Below a rule and after Cancel: destructive actions shouldn't sit in the
          same visual group as the one you're meant to tap. */}
      {editing && onDelete ? (
        <View className="mt-6 border-t border-border pt-5">
          <Button
            label="Delete category"
            variant="danger"
            onPress={onDelete}
            disabled={Boolean(deleteBlockedReason)}
          />
          {deleteBlockedReason ? (
            // Why it's disabled, not just that it is — a greyed-out button with
            // no explanation reads as a broken app.
            <Text className="font-sans mt-2.5 text-center text-label text-muted">
              {deleteBlockedReason}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
