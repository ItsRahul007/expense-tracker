import { router, useLocalSearchParams } from "expo-router";

import { useDrizzle } from "@/queries/helper";
import { mergedInto } from "@/sync/duplicates";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

import { CategoryEditor } from "@/components/category-editor";
import { CategoryPicker } from "@/components/category-picker";
import { DateField } from "@/components/date-field";
import { Button, Card, ScreenHeader } from "@/components/ui";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { usePalette } from "@/constants/palette";
import {
  amountTextToMinor,
  formatAmountFieldValue,
  formatRelativeDay,
  formatTime,
  minorToAmountText,
  sanitizeAmountInput,
} from "@/lib/format";
import { useCategories, useTransaction, useUpdateTransaction } from "@/queries";
import type { ID } from "@/types/domain";

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();

  const { data: transaction, isPending } = useTransaction(id);
  const { data: categories } = useCategories();
  const updateTransaction = useUpdateTransaction();

  const [amountText, setAmountText] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<ID | null>(null);
  const [occurredAt, setOccurredAt] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);
  const keyboard = useKeyboardInset();

  // Merged away as a duplicate by a sync while open? Move to the copy that
  // was kept rather than leaving an empty screen (design §12.9).
  const db = useDrizzle();
  useEffect(() => {
    if (isPending || transaction) return;
    const survivor = mergedInto(db, id);
    if (survivor) router.replace(`/transaction/${survivor}`);
  }, [db, id, isPending, transaction]);

  // Seed the editable copy once the record arrives, then leave it alone so a
  // refetch can't overwrite what's being typed.
  useEffect(() => {
    if (transaction && amountText === null) {
      setAmountText(minorToAmountText(transaction.amountMinor));
      setCategoryId(transaction.categoryId);
      setOccurredAt(transaction.occurredAt);
      setNote(transaction.note ?? "");
    }
  }, [transaction, amountText]);

  const amountMinor = amountText === null ? 0 : amountTextToMinor(amountText);
  const category = categories?.find((c) => c.id === categoryId);

  const dirty =
    transaction !== null &&
    transaction !== undefined &&
    (amountMinor !== transaction.amountMinor ||
      categoryId !== transaction.categoryId ||
      occurredAt !== transaction.occurredAt ||
      note !== (transaction.note ?? ""));

  const save = async () => {
    if (!transaction || categoryId === null || occurredAt === null) return;
    await updateTransaction.mutateAsync({
      id: transaction.id,
      amountMinor,
      categoryId,
      occurredAt,
      note: note.trim() || null,
    });
    router.back();
  };

  /** Confirmation lives in its own formSheet route so it matches the
   *  delete-budget flow instead of dropping a system alert on the user. */
  const confirmDelete = () => {
    if (!transaction) return;
    router.push({
      pathname: "/delete-transaction",
      params: { id: transaction.id },
    });
  };

  if (isPending || !transaction || amountText === null) {
    return (
      <View className="flex-1 bg-bg">
        <ScreenHeader title="Expense" onBack={() => router.back()} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Expense"
        subtitle={`${formatRelativeDay(transaction.occurredAt)} at ${formatTime(transaction.occurredAt)}`}
        onBack={() => router.back()}
      />

      {/* Same keyboard spacer as the add sheet: the app pans rather than
          resizes for the keyboard, so without it the lower fields and the
          buttons can't be scrolled into view while typing. */}
      <View ref={keyboard.ref} onLayout={keyboard.onLayout} className="flex-1">
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card className="py-5">
            <Text className="font-sans-medium text-label text-muted">
              Amount
            </Text>
            <View className="mt-1 flex-row items-center">
              <Text className="font-sans-bold text-display text-muted">₹</Text>
              <TextInput
                value={formatAmountFieldValue(amountText)}
                onChangeText={(next) =>
                  setAmountText(sanitizeAmountInput(next))
                }
                keyboardType="decimal-pad"
                textAlign="right"
                className="font-sans-bold ml-2 flex-1 text-display text-fg"
                // See the note in add.tsx — without minWidth: 0 the field cannot
                // shrink below its content and overflows the card.
                style={{ paddingVertical: 0, minWidth: 0 }}
                accessibilityLabel="Amount in rupees"
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
                setCategoryId(newId);
                setCreatingCategory(false);
              }}
            />
          ) : (
            <CategoryPicker
              categories={categories ?? []}
              selectedId={categoryId}
              onSelect={setCategoryId}
              onAddNew={() => setCreatingCategory(true)}
            />
          )}

          <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
            Date
          </Text>
          {occurredAt !== null ? (
            <DateField value={occurredAt} onChange={setOccurredAt} />
          ) : null}

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

          <View className="mt-8 gap-3">
            <Button
              label="Save changes"
              onPress={save}
              disabled={!dirty || amountMinor === 0}
              loading={updateTransaction.isPending}
            />
            <Button
              label="Delete expense"
              variant="danger"
              onPress={confirmDelete}
            />
          </View>

          {category ? (
            <Text className="font-sans mt-5 px-1 text-center text-label text-muted">
              Filed under {category.name}
            </Text>
          ) : null}
          <View style={{ height: keyboard.inset }} />
        </ScrollView>
      </View>
    </View>
  );
}
