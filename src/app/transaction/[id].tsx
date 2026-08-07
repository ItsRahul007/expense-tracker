import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";

import { CategoryEditor } from "@/components/category-editor";
import { CategoryPicker } from "@/components/category-picker";
import { Button, Card, Chip, ScreenHeader } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import {
  digitsToMinor,
  formatAmountEntry,
  formatRelativeDay,
  formatTime,
} from "@/lib/format";
import {
  useCategories,
  useDeleteTransaction,
  useTransaction,
  useUpdateTransaction,
} from "@/queries";
import type { ID } from "@/types/domain";

const DAY_CHOICES = 5;

function dayStart(offset: number): number {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();

  const { data: transaction, isPending } = useTransaction(id);
  const { data: categories } = useCategories();
  const updateTransaction = useUpdateTransaction();
  const deleteTransaction = useDeleteTransaction();

  const [digits, setDigits] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<ID | null>(null);
  const [occurredAt, setOccurredAt] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Seed the editable copy once the record arrives, then leave it alone so a
  // refetch can't overwrite what's being typed.
  useEffect(() => {
    if (transaction && digits === null) {
      setDigits(String(transaction.amountMinor));
      setCategoryId(transaction.categoryId);
      setOccurredAt(transaction.occurredAt);
      setNote(transaction.note ?? "");
    }
  }, [transaction, digits]);

  const amountMinor = digits === null ? 0 : digitsToMinor(digits);
  const category = categories?.find((c) => c.id === categoryId);

  /** The original date may predate the chip window, so it's offered as its own
   *  option — otherwise opening an old expense would silently re-date it. */
  const dayOptions = useMemo(() => {
    const recent = Array.from({ length: DAY_CHOICES }, (_, offset) => dayStart(offset));
    if (occurredAt !== null && occurredAt < dayStart(DAY_CHOICES - 1)) {
      return [occurredAt, ...recent];
    }
    return recent;
  }, [occurredAt]);

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

  const confirmDelete = () => {
    if (!transaction) return;
    Alert.alert("Delete this expense?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteTransaction.mutateAsync(transaction.id);
          router.back();
        },
      },
    ]);
  };

  if (isPending || !transaction || digits === null) {
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

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card className="py-5">
          <Text className="font-sans-medium text-label text-muted">Amount</Text>
          <View className="mt-1 flex-row items-center">
            <Text className="font-sans-bold text-display text-muted">₹</Text>
            <TextInput
              value={formatAmountEntry(amountMinor)}
              onChangeText={(next) => setDigits(next.replace(/\D/g, "").slice(0, 9))}
              keyboardType="number-pad"
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
        <View className="flex-row flex-wrap gap-2">
          {dayOptions.map((ts) => (
            <Chip
              key={ts}
              label={formatRelativeDay(ts)}
              selected={ts === occurredAt}
              onPress={() => setOccurredAt(ts)}
            />
          ))}
        </View>

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
            loading={deleteTransaction.isPending}
          />
        </View>

        {category ? (
          <Text className="font-sans mt-5 px-1 text-center text-label text-muted">
            Filed under {category.name}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
