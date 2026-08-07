import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Button, Card, Chip, IconBadge } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import {
  digitsToMinor,
  formatAmountEntry,
  formatMoney,
  formatRelativeDay,
} from "@/lib/format";
import { currentMonth } from "@/lib/month";
import { useAddTransaction, useCategories, useTransactions } from "@/queries";
import type { ID } from "@/types/domain";

/** How far back the day chips reach. A full date picker isn't here because
 *  "I forgot to log yesterday's auto" is the real case and a week covers it;
 *  older dates stay editable from the expense detail screen. */
const DAY_CHOICES = 5;

function dayStart(offset: number): number {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  d.setHours(12, 0, 0, 0); // midday, so a DST shift can't move the calendar day
  return d.getTime();
}

export default function AddScreen() {
  const palette = usePalette();
  const { data: categories } = useCategories();
  const { data: recent } = useTransactions(currentMonth());
  const addTransaction = useAddTransaction();

  const [digits, setDigits] = useState("");
  const [chosenCategory, setChosenCategory] = useState<ID | null>(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [note, setNote] = useState("");

  /** Defaults to the last category used, which is right far more often than
   *  alphabetical order — it makes the common case a two-field form. */
  const categoryId =
    chosenCategory ?? recent?.[0]?.categoryId ?? categories?.[0]?.id ?? null;

  const amountMinor = digitsToMinor(digits);
  const occurredAt = useMemo(() => dayStart(dayOffset), [dayOffset]);
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
    <View className="flex-1 bg-bg">
      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <Text className="font-sans-bold text-title text-fg">New expense</Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full border border-border bg-card"
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
        >
          <Ionicons name="close" size={18} color={palette.fg} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Amount first and largest — it's the only field that always needs
            filling, so it gets its own card and the numeric keyboard. */}
        <Card className="py-5">
          <Text className="font-sans-medium text-label text-muted">Amount</Text>
          {/* The symbol is a fixed-width sibling and the field takes the rest of
              the row: a TextInput sized by its content stretches past the card on
              web and clips long amounts on native. */}
          <View className="mt-1 flex-row items-center">
            <Text className="font-sans-bold text-display text-muted">₹</Text>
            <TextInput
              autoFocus
              value={digits === "" ? "" : formatAmountEntry(amountMinor)}
              onChangeText={(next) => setDigits(next.replace(/\D/g, "").slice(0, 9))}
              keyboardType="number-pad"
              placeholder="0.00"
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
            Digits fill from the right — type 1240 for ₹12.40
          </Text>
        </Card>

        <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
          Category
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {(categories ?? []).map((category) => {
            const selected = category.id === categoryId;
            return (
              <Pressable
                key={category.id}
                onPress={() => setChosenCategory(category.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={category.name}
                className={`w-[31%] items-center gap-1.5 rounded-2xl border py-3 ${
                  selected ? "border-accent bg-accent/10" : "border-border bg-card"
                }`}
                style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
              >
                <IconBadge icon={category.icon} color={category.color} size="sm" />
                <Text
                  numberOfLines={1}
                  className={`font-sans-medium px-1 text-caption ${
                    selected ? "text-accent" : "text-muted"
                  }`}
                >
                  {category.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text className="font-sans-semibold mb-2 mt-6 px-1 text-headline text-fg">
          Date
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {Array.from({ length: DAY_CHOICES }, (_, offset) => (
            <Chip
              key={offset}
              label={formatRelativeDay(dayStart(offset))}
              selected={offset === dayOffset}
              onPress={() => setDayOffset(offset)}
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

        <View className="mt-8">
          <Button
            label={`Save ${amountMinor > 0 ? formatMoney(amountMinor) : "expense"}`}
            onPress={save}
            disabled={!canSave}
            loading={addTransaction.isPending}
          />
        </View>
      </ScrollView>
    </View>
  );
}
