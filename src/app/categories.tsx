import { router } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { CategoryEditor } from "@/components/category-editor";
import { Card, IconBadge, ScreenHeader, SectionTitle } from "@/components/ui";
import { useCategories } from "@/queries";

export default function CategoriesScreen() {
  const { data: categories } = useCategories();
  const count = categories?.length ?? 0;

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Categories"
        subtitle={`${count} ${count === 1 ? "category" : "categories"}`}
        onBack={() => router.back()}
      />

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
          Categories can be added but not deleted. Removing one that already has
          expenses attached needs a rule for where those expenses go, which belongs
          in the data layer.
        </Text>
      </ScrollView>
    </View>
  );
}
