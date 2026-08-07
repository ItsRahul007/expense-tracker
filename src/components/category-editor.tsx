import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Button, Card, IconBadge } from "@/components/ui";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/constants/category-options";
import { usePalette } from "@/constants/palette";
import { useCategories, useUpsertCategory } from "@/queries";
import type { ID } from "@/types/domain";

/**
 * Create a custom category: name, icon, colour.
 *
 * Shared between the Categories screen and the inline "New category" step in the
 * add-expense sheet, so both offer exactly the same options and generate ids the
 * same way.
 *
 * `onCreated` receives the new id so the add-expense flow can select the category
 * immediately — creating one and then having to hunt for it in the grid would
 * make the shortcut pointless.
 */
export function CategoryEditor({
  onCreated,
  onCancel,
  autoFocus = false,
}: {
  onCreated?: (id: ID) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const palette = usePalette();
  const { data: categories } = useCategories();
  const upsertCategory = useUpsertCategory();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState(CATEGORY_ICONS[0]);
  const [color, setColor] = useState(CATEGORY_COLORS[0]);

  const trimmed = name.trim();
  const existing = categories ?? [];
  const duplicate = existing.some(
    (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = trimmed.length > 0 && !duplicate;

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

  const create = () => {
    if (!canCreate) return;
    const id = makeId();
    upsertCategory.mutate({
      id,
      name: trimmed,
      icon,
      color,
      sortOrder: existing.length + 1,
    });
    setName("");
    setIcon(CATEGORY_ICONS[0]);
    setColor(CATEGORY_COLORS[0]);
    onCreated?.(id);
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
          onSubmitEditing={create}
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

      <Text className="font-sans-medium mb-2 mt-5 text-label text-muted">Icon</Text>
      <View className="flex-row flex-wrap gap-2">
        {CATEGORY_ICONS.map((choice) => (
          <Pressable
            key={choice}
            onPress={() => setIcon(choice)}
            accessibilityRole="button"
            accessibilityLabel={`Icon ${choice}`}
            accessibilityState={{ selected: icon === choice }}
            className={`h-11 w-11 items-center justify-center rounded-xl border ${
              icon === choice ? "border-accent bg-accent/10" : "border-border bg-bg"
            } active:opacity-60`}
          >
            <Ionicons
              name={choice as never}
              size={19}
              color={icon === choice ? palette.accent : palette.muted}
            />
          </Pressable>
        ))}
      </View>

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

      <View className="mt-6 gap-3">
        <Button label="Create category" onPress={create} disabled={!canCreate} />
        {onCancel ? (
          <Button label="Cancel" variant="secondary" onPress={onCancel} />
        ) : null}
      </View>
    </Card>
  );
}
