import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Eyebrow, LedgerSheet, Rule, ScreenHeader } from "@/components/ledger";
import { usePalette } from "@/constants/palette";
import { useCategories, useUpsertCategory } from "@/queries";

export default function CategoriesScreen() {
  const palette = usePalette();
  const { data: categories } = useCategories();
  const upsertCategory = useUpsertCategory();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const canAdd = name.trim().length > 0 && code.trim().length >= 2;

  const add = () => {
    if (!canAdd) return;
    upsertCategory.mutate({
      id: `c-${code.trim().toLowerCase()}`,
      name: name.trim(),
      code: code.trim().toUpperCase().slice(0, 4),
      sortOrder: (categories?.length ?? 0) + 1,
    });
    setName("");
    setCode("");
  };

  return (
    <View className="flex-1 bg-paper">
      <ScreenHeader
        title="Categories"
        actions={[{ label: "Close", onPress: () => router.back() }]}
      />

      <LedgerSheet>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {(categories ?? []).map((category, index) => (
            <View key={category.id}>
              <Rule />
              <View
                className={`h-row flex-row items-center pl-4 pr-7 ${
                  index % 2 === 1 ? "bg-row-alt" : ""
                }`}
              >
                <Text className="font-sans-medium flex-1 text-row text-ink">
                  {category.name}
                </Text>
                <Text className="font-mono-medium text-amount text-ink-muted">
                  {category.code}
                </Text>
              </View>
            </View>
          ))}

          <Rule />
          <View className="h-10 justify-end pb-2 pl-4">
            <Eyebrow>Add a category</Eyebrow>
          </View>
          <Rule />

          <View className="flex-row items-center pl-4 pr-7">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={palette.inkMuted}
              className="font-sans-medium h-12 flex-1 text-row text-ink"
            />
            <TextInput
              value={code}
              onChangeText={(next) => setCode(next.toUpperCase().slice(0, 4))}
              placeholder="CODE"
              placeholderTextColor={palette.inkMuted}
              autoCapitalize="characters"
              className="font-mono-medium h-12 w-16 text-right text-amount text-ink"
            />
          </View>
          <Rule />

          <Pressable
            onPress={add}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canAdd }}
            className="h-12 items-center justify-center"
            style={({ pressed }) => ({ opacity: !canAdd ? 0.3 : pressed ? 0.5 : 1 })}
          >
            <Text className="font-sans-semibold text-eyebrow uppercase tracking-eyebrow text-ink">
              Add category
            </Text>
          </Pressable>

          <View className="px-4 pt-6">
            <Text className="font-sans text-meta text-ink-muted">
              Categories can be added but not deleted. Removing one that already
              has entries attached needs a rule for where those entries go, and
              that belongs in the data layer rather than here.
            </Text>
          </View>
        </ScrollView>
      </LedgerSheet>
    </View>
  );
}
