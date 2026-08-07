import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Button, Card, IconBadge, ScreenHeader, SectionTitle } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { useCategories, useUpsertCategory } from "@/queries";

/** A small curated set rather than the whole Ionicons library — enough to cover
 *  ordinary spending without turning this into an icon browser. */
const ICON_CHOICES = [
  "restaurant", "cart", "car", "receipt", "fitness", "bag-handle",
  "game-controller", "airplane", "gift", "paw", "school", "ellipsis-horizontal",
];

const COLOR_CHOICES = [
  "#F97316", "#10B981", "#3B82F6", "#8B5CF6",
  "#EC4899", "#F59E0B", "#06B6D4", "#6B7280",
];

export default function CategoriesScreen() {
  const palette = usePalette();
  const { data: categories } = useCategories();
  const upsertCategory = useUpsertCategory();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState(ICON_CHOICES[0]);
  const [color, setColor] = useState(COLOR_CHOICES[0]);

  const canAdd = name.trim().length > 0;

  const add = () => {
    if (!canAdd) return;
    upsertCategory.mutate({
      id: `c-${name.trim().toLowerCase().replace(/\s+/g, "-")}`,
      name: name.trim(),
      icon,
      color,
      sortOrder: (categories?.length ?? 0) + 1,
    });
    setName("");
    setIcon(ICON_CHOICES[0]);
    setColor(COLOR_CHOICES[0]);
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Categories" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card padded={false} className="overflow-hidden">
          {(categories ?? []).map((category, index) => (
            <View key={category.id}>
              <View className="flex-row items-center gap-3 px-4 py-3">
                <IconBadge icon={category.icon} color={category.color} />
                <Text className="font-sans-medium flex-1 text-body text-fg">
                  {category.name}
                </Text>
              </View>
              {index < (categories?.length ?? 0) - 1 ? (
                <View className="ml-[68px] h-px bg-border" />
              ) : null}
            </View>
          ))}
        </Card>

        <View className="mt-6">
          <SectionTitle title="Add a category" />
          <Card>
            <View className="flex-row items-center gap-3">
              <IconBadge icon={icon} color={color} size="lg" />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Category name"
                placeholderTextColor={palette.muted}
                className="font-sans-medium h-12 flex-1 rounded-xl border border-border bg-bg px-3 text-body text-fg"
                style={{ minWidth: 0 }}
              />
            </View>

            <Text className="font-sans-medium mb-2 mt-5 text-label text-muted">
              Icon
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {ICON_CHOICES.map((choice) => (
                <Pressable
                  key={choice}
                  onPress={() => setIcon(choice)}
                  accessibilityRole="button"
                  accessibilityLabel={`Icon ${choice}`}
                  accessibilityState={{ selected: icon === choice }}
                  className={`h-11 w-11 items-center justify-center rounded-xl border ${
                    icon === choice ? "border-accent bg-accent/10" : "border-border bg-bg"
                  }`}
                  style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
                >
                  <Ionicons
                    name={choice as never}
                    size={19}
                    color={icon === choice ? palette.accent : palette.muted}
                  />
                </Pressable>
              ))}
            </View>

            <Text className="font-sans-medium mb-2 mt-5 text-label text-muted">
              Colour
            </Text>
            <View className="flex-row flex-wrap gap-2.5">
              {COLOR_CHOICES.map((choice) => (
                <Pressable
                  key={choice}
                  onPress={() => setColor(choice)}
                  accessibilityRole="button"
                  accessibilityLabel={`Colour ${choice}`}
                  accessibilityState={{ selected: color === choice }}
                  className="h-9 w-9 items-center justify-center rounded-full"
                  style={({ pressed }) => ({
                    backgroundColor: choice,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  {color === choice ? (
                    <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                  ) : null}
                </Pressable>
              ))}
            </View>

            <View className="mt-6">
              <Button label="Add category" onPress={add} disabled={!canAdd} />
            </View>
          </Card>
        </View>

        <Text className="font-sans mt-5 px-1 text-label text-muted">
          Categories can be added but not deleted. Removing one that already has
          expenses attached needs a rule for where those expenses go, which belongs
          in the data layer.
        </Text>
      </ScrollView>
    </View>
  );
}
