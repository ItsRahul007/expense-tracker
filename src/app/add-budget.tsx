import { Ionicons } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { CategoryEditor } from "@/components/category-editor";
import { CategoryPicker } from "@/components/category-picker";
import { Button, Card } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { formatMoney } from "@/lib/format";
import { currentMonth } from "@/lib/month";
import { useCategories, useUpsertBudget } from "@/queries";
import type { ID } from "@/types/domain";

export default function AddBudgetScreen() {
  const palette = usePalette();
  const navigation = useNavigation();
  const month = currentMonth();

  const { data: categories } = useCategories();
  const upsertBudget = useUpsertBudget();

  const [chosenCategory, setChosenCategory] = useState<ID | null>(null);
  const [draft, setDraft] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  /**
   * The icon and colour grids need roughly a full screen, and the sheet's normal
   * 0.6 detent leaves them behind the keyboard. Detents are a navigation option,
   * so the sheet is grown for the duration of the editor and shrunk back after —
   * the alternative is making the user drag the sheet up mid-form.
   */
  useEffect(() => {
    navigation.setOptions({
      sheetAllowedDetents: creatingCategory ? [0.95] : [0.6],
    } as never);
  }, [navigation, creatingCategory]);

  const categoryId = chosenCategory ?? categories?.[0]?.id ?? null;
  const limitMinor = Number(draft.replace(/\D/g, "")) * 100;
  const canSave = categoryId !== null && limitMinor > 0;

  const save = async () => {
    if (!canSave || categoryId === null) return;
    await upsertBudget.mutateAsync({ categoryId, month, limitMinor });
    router.back();
  };

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <Text className="font-sans-bold text-title text-fg">New budget</Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full border border-border bg-card active:opacity-60"
        >
          <Ionicons name="close" size={18} color={palette.fg} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card className="py-5">
          <Text className="font-sans-medium text-label text-muted">
            Monthly limit
          </Text>
          <View className="mt-1 flex-row items-center">
            <Text className="font-sans-bold text-display text-muted">₹</Text>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={(next) => setDraft(next.replace(/\D/g, ""))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={palette.muted}
              textAlign="right"
              className="font-sans-bold ml-2 flex-1 text-display text-fg"
              style={{ paddingVertical: 0, minWidth: 0 }}
              accessibilityLabel="Monthly limit in rupees"
            />
          </View>
        </Card>

        <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
          Category
        </Text>

        {creatingCategory ? (
          <CategoryEditor
            autoFocus
            onCancel={() => setCreatingCategory(false)}
            onCreated={(newId) => {
              setChosenCategory(newId);
              setCreatingCategory(false);
            }}
          />
        ) : (
          // Same dashed "New" tile as the add-expense sheet: realising a
          // category is missing shouldn't mean abandoning this form. Picking a
          // category that already has a budget this month just updates it.
          <CategoryPicker
            categories={categories ?? []}
            selectedId={categoryId}
            onSelect={setChosenCategory}
            onAddNew={() => setCreatingCategory(true)}
          />
        )}

        <View className="mt-8">
          <Button
            label={`Save ${limitMinor > 0 ? formatMoney(limitMinor) : "budget"}`}
            onPress={save}
            disabled={!canSave}
            loading={upsertBudget.isPending}
          />
        </View>
      </ScrollView>
    </View>
  );
}
