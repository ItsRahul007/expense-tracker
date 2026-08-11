import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";

import { CategoryEditor } from "@/components/category-editor";
import { Card, IconBadge, ScreenHeader, SectionTitle } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { useCategoryUsage } from "@/hooks/use-category-usage";
import { useCategories } from "@/queries";
import type { Category, ID } from "@/types/domain";

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
          // Remount per category so the form re-seeds from the row tapped — and
          // so the usage query inside is only ever live for the open editor.
          <EditPanel
            key={editing.id}
            category={editing}
            onDone={() => setEditingId(null)}
          />
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
              Tap a category to rename it, change its icon and colour, or delete
              it. A category can only be deleted once nothing points at it.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * The open editor, plus the delete action and the reason it's unavailable.
 *
 * Its own component so the usage query only runs while a category is actually
 * being edited — hoisting it into the screen would have it counting rows for
 * every row in the list, on a screen that mostly just shows a list.
 */
function EditPanel({
  category,
  onDone,
}: {
  category: Category;
  onDone: () => void;
}) {
  const usage = useCategoryUsage(category.id);

  /** Null means deletable. Anything else is shown under the button. */
  const blockedReason = usage.isPending
    ? "Checking where this category is used…"
    : usage.transactionCount > 0
      ? `${usage.transactionCount} ${usage.transactionCount === 1 ? "expense is" : "expenses are"} filed here — move or delete them first.`
      : usage.hasBudget
        ? "This category has a budget this month — remove the budget first."
        : null;

  return (
    <View>
      {/* The name is already in the header subtitle — repeating it here just
          crowds the form. */}
      <SectionTitle title="Edit category" />
      <CategoryEditor
        category={category}
        onSaved={onDone}
        onCancel={onDone}
        onDelete={() =>
          router.push({
            pathname: "/delete-category",
            params: { id: category.id },
          })
        }
        deleteBlockedReason={blockedReason}
      />
      <Text className="font-sans mt-5 px-1 text-label text-muted">
        Renaming or recolouring keeps every expense already filed here — they
        point at the category, not at its name.
      </Text>
    </View>
  );
}
