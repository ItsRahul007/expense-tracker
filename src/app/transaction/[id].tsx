import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { Chip } from "@/components/keypad/chip";
import { NumericKeypad } from "@/components/keypad/numeric-keypad";
import {
  Amount,
  DoubleRule,
  Eyebrow,
  LedgerSheet,
  MetaRow,
  Rule,
  ScreenHeader,
} from "@/components/ledger";
import { usePalette } from "@/constants/palette";
import { digitsToMinor, formatRelativeDay } from "@/lib/format";
import {
  useCategories,
  useDeleteTransaction,
  useTransaction,
  useUpdateTransaction,
} from "@/queries";
import type { ID } from "@/types/domain";

const DAY_CHOICES = 7;

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
  const [note, setNote] = useState<string | null>(null);
  const [picker, setPicker] = useState<"amount" | "category" | "date" | null>(null);

  // Seed the editable copy once the record arrives, then leave it alone so a
  // background refetch can't overwrite what's being typed.
  useEffect(() => {
    if (transaction && digits === null) {
      setDigits(String(transaction.amountMinor));
      setCategoryId(transaction.categoryId);
      setOccurredAt(transaction.occurredAt);
      setNote(transaction.note ?? "");
    }
  }, [transaction, digits]);

  if (isPending || !transaction || digits === null) {
    return (
      <View className="flex-1 bg-paper">
        <ScreenHeader
          title="Entry"
          actions={[{ label: "Close", onPress: () => router.back() }]}
        />
      </View>
    );
  }

  const amountMinor = digitsToMinor(digits);
  const category = categories?.find((c) => c.id === categoryId);

  const dirty =
    amountMinor !== transaction.amountMinor ||
    categoryId !== transaction.categoryId ||
    occurredAt !== transaction.occurredAt ||
    (note ?? "") !== (transaction.note ?? "");

  const save = async () => {
    await updateTransaction.mutateAsync({
      id: transaction.id,
      amountMinor,
      categoryId: categoryId ?? transaction.categoryId,
      occurredAt: occurredAt ?? transaction.occurredAt,
      note: (note ?? "").trim() || null,
    });
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete this entry?",
      "It will be removed from the ledger. This cannot be undone.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteTransaction.mutateAsync(transaction.id);
            router.back();
          },
        },
      ],
    );
  };

  /** The original date may be older than the chip window, so it's offered as its
   *  own chip — otherwise editing a two-month-old entry would silently move it. */
  const dayOptions = [
    ...(occurredAt !== null && occurredAt < dayStart(DAY_CHOICES - 1)
      ? [occurredAt]
      : []),
    ...Array.from({ length: DAY_CHOICES }, (_, offset) => dayStart(offset)),
  ];

  return (
    <View className="flex-1 bg-paper">
      <ScreenHeader
        title="Entry"
        actions={[
          ...(dirty
            ? [{ label: updateTransaction.isPending ? "Saving…" : "Save", onPress: save }]
            : []),
          { label: "Close", onPress: () => router.back() },
        ]}
      />

      <LedgerSheet>
        <View className="flex-1">
          <Pressable
            onPress={() => setPicker(picker === "amount" ? null : "amount")}
            accessibilityRole="button"
            accessibilityLabel="Edit amount"
            className="flex-row items-end justify-between py-6 pl-4 pr-7"
            style={({ pressed }) => (pressed ? { opacity: 0.55 } : undefined)}
          >
            <Eyebrow className="pb-3">Amount ₹</Eyebrow>
            <Amount amountMinor={amountMinor} size="display" />
          </Pressable>

          <MetaRow
            label="Category"
            value={category?.name ?? "—"}
            onPress={() => setPicker(picker === "category" ? null : "category")}
            expanded={
              picker === "category" ? (
                <View className="flex-row flex-wrap gap-2">
                  {(categories ?? []).map((c) => (
                    <Chip
                      key={c.id}
                      label={c.code}
                      selected={c.id === categoryId}
                      onPress={() => {
                        setCategoryId(c.id);
                        setPicker(null);
                      }}
                    />
                  ))}
                </View>
              ) : null
            }
          />

          <MetaRow
            label="Date"
            value={occurredAt ? formatRelativeDay(occurredAt) : "—"}
            onPress={() => setPicker(picker === "date" ? null : "date")}
            expanded={
              picker === "date" ? (
                <View className="flex-row flex-wrap gap-2">
                  {dayOptions.map((ts) => (
                    <Chip
                      key={ts}
                      label={formatRelativeDay(ts).slice(0, 9)}
                      selected={ts === occurredAt}
                      onPress={() => {
                        setOccurredAt(ts);
                        setPicker(null);
                      }}
                    />
                  ))}
                </View>
              ) : null
            }
          />

          <Rule />
          <View className="h-12 flex-row items-center pl-4 pr-7">
            <Eyebrow>Note</Eyebrow>
            <TextInput
              value={note ?? ""}
              onChangeText={setNote}
              placeholder="Optional"
              returnKeyType="done"
              className="font-sans-medium ml-4 flex-1 text-right text-row text-ink"
              placeholderTextColor={palette.inkMuted}
            />
          </View>
          <Rule />
        </View>
      </LedgerSheet>

      {picker === "amount" ? (
        <NumericKeypad
          onDigits={(next) => setDigits((current) => ((current ?? "") + next).slice(0, 9))}
          onBackspace={() => setDigits((current) => (current ?? "").slice(0, -1))}
        />
      ) : null}

      <DoubleRule />
      <Pressable
        onPress={confirmDelete}
        accessibilityRole="button"
        className="h-14 items-center justify-center"
        style={({ pressed }) => (pressed ? { opacity: 0.5 } : undefined)}
      >
        <Text className="font-sans-semibold text-eyebrow uppercase tracking-eyebrow text-alert">
          {deleteTransaction.isPending ? "Deleting…" : "Delete entry"}
        </Text>
      </Pressable>
    </View>
  );
}
