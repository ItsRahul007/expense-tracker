import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { CategoryEditor } from "@/components/category-editor";
import { Card, IconBadge, ScreenHeader, SectionTitle } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { useCategories } from "@/queries";
import type { ID } from "@/types/domain";

export default function CategoriesScreen() {
  const palette = usePalette();
  const { data: categories } = useCategories();
  const [editingId, setEditingId] = useState<ID | null>(null);

  const count = categories?.length ?? 0;
  const editing = categories?.find((c) => c.id === editingId) ?? null;

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Categories"
        subtitle={
          editing
            ? "Editing"
            : `${count} ${count === 1 ? "category" : "categories"}`
        }
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* One editor on screen at a time. Expanding a row in place would push
            the rest of the list off-screen anyway, and two open forms make it
            ambiguous which one the keyboard belongs to. */}
        {editing ? (
          <View>
            <SectionTitle title={`Edit ${editing.name}`} />
            <CategoryEditor
              // Remount per category so the form re-seeds from the row tapped.
              key={editing.id}
              category={editing}
              onSaved={() => setEditingId(null)}
              onCancel={() => setEditingId(null)}
            />
            <Text className="font-sans mt-5 px-1 text-label text-muted">
              Renaming or recolouring keeps every expense already filed here —
              they point at the category, not at its name.
            </Text>
          </View>
        ) : (
          <>
            <Card padded={false} className="overflow-hidden">
              {(categories ?? []).map((category, index) => (
                <View key={category.id}>
                  <Pressable
                    onPress={() => setEditingId(category.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${category.name}`}
                    className="flex-row items-center gap-3 px-4 py-3 active:opacity-60"
                  >
                    <IconBadge icon={category.icon} color={category.color} />
                    <Text className="font-sans-medium flex-1 text-body text-fg">
                      {category.name}
                    </Text>
                    {/* A pencil rather than a chevron: tapping the row edits it,
                        it doesn't navigate anywhere. */}
                    <Ionicons name="pencil" size={16} color={palette.muted} />
                  </Pressable>
                  {index < count - 1 ? (
                    <View className="ml-[68px] h-px bg-border" />
                  ) : null}
                </View>
              ))}
            </Card>

            <View className="mt-6">
              <SectionTitle title="Add a category" />
              {/* Same editor the add-expense sheet uses inline, so the icon and
                  colour options can't drift between the two entry points. */}
              <CategoryEditor />
            </View>

            <Text className="font-sans mt-5 px-1 text-label text-muted">
              Tap a category to rename it or change its icon and colour.
              Categories can not be deleted yet — removing one that already has
              expenses attached needs a rule for where those expenses go, which
              belongs in the data layer.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}
