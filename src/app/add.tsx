import { router } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useSheetScroll } from "@/hooks/use-sheet-scroll";
import { CategoryEditor } from "@/components/category-editor";
import { CategoryPicker } from "@/components/category-picker";
import { DateField, dayStart } from "@/components/date-field";
import { Button, Card } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import {
  amountTextToMinor,
  formatAmountFieldValue,
  formatMoney,
  sanitizeAmountInput,
} from "@/lib/format";
import { currentMonth } from "@/lib/month";
import { useAddTransaction, useCategories, useTransactions } from "@/queries";
import type { ID } from "@/types/domain";

export default function AddScreen() {
  const palette = usePalette();
  const { data: categories } = useCategories();
  const { data: recent } = useTransactions(currentMonth());
  const addTransaction = useAddTransaction();

  const [amountText, setAmountText] = useState("");
  const [chosenCategory, setChosenCategory] = useState<ID | null>(null);
  const [occurredAt, setOccurredAt] = useState(() => dayStart(0));
  const [note, setNote] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const keyboard = useKeyboardInset();
  const scroll = useSheetScroll();

  /** Defaults to the last category used, which is right far more often than
   *  alphabetical order — it makes the common case a two-field form. */
  const categoryId =
    chosenCategory ?? recent?.[0]?.categoryId ?? categories?.[0]?.id ?? null;

  const amountMinor = amountTextToMinor(amountText);

  const canSave = amountMinor > 0 && categoryId !== null;

  const save = async () => {
    if (!canSave || categoryId === null) return;
    await addTransaction.mutateAsync({
      amountMinor,
      categoryId,
      occurredAt,
      note: note.trim() || null,
    });
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={100}
    >
      <View className="flex-1 bg-sheet dark:border-t dark:border-border">
        <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
          <Text className="font-sans-bold text-title text-fg">New expense</Text>
          <View />
        </View>

        <View
          ref={keyboard.ref}
          onLayout={keyboard.onLayout}
          className="flex-1"
        >
          <ScrollView
            // Drag-down closes the sheet whether or not the form scrolls (see
            // useSheetScroll for why the content is kept 1 px taller).
            nestedScrollEnabled
            onLayout={scroll.onLayout}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 24,
              minHeight: scroll.contentMinHeight,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Amount first and largest — it's the only field that always needs
            filling, so it gets its own card and the numeric keyboard. */}
            <Card className="py-5">
              <Text className="font-sans-medium text-label text-muted">
                Amount
              </Text>
              {/* The symbol is a fixed-width sibling and the field takes the rest of
              the row: a TextInput sized by its content stretches past the card on
              web and clips long amounts on native. */}
              <View className="mt-1 flex-row items-center">
                <Text className="font-sans-bold text-display text-muted">
                  ₹
                </Text>
                <TextInput
                  autoFocus
                  value={formatAmountFieldValue(amountText)}
                  onChangeText={(next) =>
                    setAmountText(sanitizeAmountInput(next))
                  }
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={palette.muted}
                  textAlign="right"
                  className="font-sans-bold ml-2 flex-1 text-display text-fg"
                  // minWidth: 0 — a flex item's min-width defaults to its content
                  // size, so without this the field refuses to shrink and pushes the
                  // whole card past the screen edge on long amounts.
                  style={{ paddingVertical: 0, minWidth: 0 }}
                  accessibilityLabel="Amount in rupees"
                />
              </View>
              <Text className="font-sans mt-2 text-caption text-muted">
                Type the rupee amount — tap . to add paise
              </Text>
            </Card>

            <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
              Category
            </Text>

            {creatingCategory ? (
              <CategoryEditor
                autoFocus
                onCancel={() => setCreatingCategory(false)}
                onCreated={(id) => {
                  // Select it straight away — the whole reason for creating one here
                  // is to keep going with this expense.
                  setChosenCategory(id);
                  setCreatingCategory(false);
                }}
              />
            ) : (
              <CategoryPicker
                categories={categories ?? []}
                selectedId={categoryId}
                onSelect={setChosenCategory}
                onAddNew={() => setCreatingCategory(true)}
              />
            )}

            <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
              Date
            </Text>
            <DateField value={occurredAt} onChange={setOccurredAt} />

            <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
              Note
            </Text>
            <Card padded={false}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Where was it? (optional)"
                placeholderTextColor={palette.muted}
                returnKeyType="done"
                className="font-sans min-h-[52px] px-4 py-3 text-body text-fg"
              />
            </Card>

            <View className="mt-8">
              <Button
                label={`Save ${amountMinor > 0 ? formatMoney(amountMinor) : "expense"}`}
                onPress={save}
                disabled={!canSave}
                loading={addTransaction.isPending}
              />
            </View>
            <View style={{ height: keyboard.inset }} />
          </ScrollView>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
