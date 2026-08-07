import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { IconBadge } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import type { Category, ID } from "@/types/domain";

/**
 * The three-across grid of category tiles, shared by the add and edit screens so
 * both stay in step.
 *
 * When `onAddNew` is supplied a dashed "New" tile is appended. That tile is the
 * whole point: without it, discovering that a category is missing halfway through
 * logging an expense means abandoning the form and going to Settings, and the
 * expense usually just gets filed under "Other" instead.
 */
export function CategoryPicker({
  categories,
  selectedId,
  onSelect,
  onAddNew,
}: {
  categories: Category[];
  selectedId: ID | null;
  onSelect: (id: ID) => void;
  onAddNew?: () => void;
}) {
  const palette = usePalette();

  return (
    <View className="flex-row flex-wrap gap-2">
      {categories.map((category) => {
        const selected = category.id === selectedId;
        return (
          <Pressable
            key={category.id}
            onPress={() => onSelect(category.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={category.name}
            className={`w-[31%] items-center gap-1.5 rounded-2xl border py-3 ${
              selected ? "border-accent bg-accent/10" : "border-border bg-card"
            } active:opacity-70`}
          >
            <IconBadge icon={category.icon} color={category.color} size="sm" />
            <Text
              numberOfLines={1}
              className={`font-sans-medium px-1 text-caption ${
                selected ? "text-accent" : "text-muted"
              }`}
            >
              {category.name}
            </Text>
          </Pressable>
        );
      })}

      {onAddNew ? (
        <Pressable
          onPress={onAddNew}
          accessibilityRole="button"
          accessibilityLabel="Create a new category"
          // Dashed border marks it as the odd one out — an action, not a choice.
          className="w-[31%] items-center gap-1.5 rounded-2xl border border-dashed border-border bg-transparent py-3 active:opacity-60"
        >
          <View className="h-8 w-8 items-center justify-center rounded-full bg-accent/10">
            <Ionicons name="add" size={18} color={palette.accent} />
          </View>
          <Text className="font-sans-medium px-1 text-caption text-accent">New</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
