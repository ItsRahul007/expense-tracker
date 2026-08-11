import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";

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

  /**
   * Editing is screen state, not a route, so "back" has two meanings here and the
   * shallower one has to win: close the editor, and only leave the screen once
   * the list is what's showing. Otherwise one tap skips the list entirely and
   * lands on Settings, silently dropping whatever was being edited.
   */
  const goBack = () => {
    if (editing) {
      setEditingId(null);
      return;
    }
    router.back();
  };

  // The header chevron is only one of the ways back. Android's system gesture
  // and hardware button bypass it completely, so they need the same rule.
  useEffect(() => {
    if (!editing) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setEditingId(null);
      return true; // handled — don't let the navigator pop the screen too
    });
    return () => subscription.remove();
  }, [editing]);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Categories"
        subtitle={
          editing
            ? `Editing ${editing.name}`
            : `${count} ${count === 1 ? "category" : "categories"}`
        }
        onBack={goBack}
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
            {/* The name is already in the header subtitle — repeating it here
                just crowds the form. */}
            <SectionTitle title="Edit category" />
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
