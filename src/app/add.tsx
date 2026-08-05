import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Chip } from "@/components/keypad/chip";
import { NumericKeypad } from "@/components/keypad/numeric-keypad";
import {
  Amount,
  DoubleRule,
  Eyebrow,
  LedgerSheet,
  MetaRow,
  Rule,
} from "@/components/ledger";
import { usePalette } from "@/constants/palette";
import { digitsToMinor, formatRelativeDay } from "@/lib/format";
import { currentMonth } from "@/lib/month";
import { useAddTransaction, useCategories, useTransactions } from "@/queries";
import type { ID } from "@/types/domain";

/** How far back the day chips reach. A full date picker is deliberately not here
 *  — "I forgot to log yesterday's auto" is the real case, and a week of chips
 *  covers it without a new dependency or a modal inside a modal. Older dates are
 *  editable from the entry detail screen. */
const DAY_CHOICES = 7;

function dayStart(offset: number): number {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  d.setHours(12, 0, 0, 0); // midday, so DST shifts can't move the calendar day
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
  const [picker, setPicker] = useState<"category" | "date" | null>(null);

  /** Defaults to the last category used, which is right far more often than
   *  alphabetical order is — the two-tap path depends on it. */
  const categoryId =
    chosenCategory ?? recent?.[0]?.categoryId ?? categories?.[0]?.id ?? null;
  const category = categories?.find((c) => c.id === categoryId);

  const amountMinor = digitsToMinor(digits);
  const occurredAt = useMemo(() => dayStart(dayOffset), [dayOffset]);
  const canSave = amountMinor > 0 && categoryId !== null && !addTransaction.isPending;

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
    <View className="flex-1 bg-paper">
      <View className="h-12 flex-row items-center justify-between pl-4 pr-7">
        <Eyebrow>New entry</Eyebrow>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          hitSlop={10}
          style={({ pressed }) => (pressed ? { opacity: 0.5 } : undefined)}
        >
          <Text className="font-sans-semibold text-meta text-ink-muted">Cancel</Text>
        </Pressable>
      </View>

      {/* Wraps only the figure and the meta rows: the alignment rule must not
          run down through the keypad's right-hand column. */}
      <LedgerSheet>
        <View className="flex-1 justify-end pb-5">
          <View className="flex-row items-end justify-between pl-4 pr-7">
            <Eyebrow className="pb-3">Amount ₹</Eyebrow>
            <Amount
              amountMinor={amountMinor}
              size="display"
              tone={amountMinor > 0 ? "ink" : "muted"}
            />
          </View>
        </View>

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
                      setChosenCategory(c.id);
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
          value={formatRelativeDay(occurredAt)}
          onPress={() => setPicker(picker === "date" ? null : "date")}
          expanded={
            picker === "date" ? (
              <View className="flex-row flex-wrap gap-2">
                {Array.from({ length: DAY_CHOICES }, (_, offset) => (
                  <Chip
                    key={offset}
                    label={
                      offset === 0
                        ? "Today"
                        : offset === 1
                          ? "Yest"
                          : formatRelativeDay(dayStart(offset)).slice(0, 6)
                    }
                    selected={offset === dayOffset}
                    onPress={() => {
                      setDayOffset(offset);
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
            value={note}
            onChangeText={setNote}
            placeholder="Optional"
            returnKeyType="done"
            className="font-sans-medium ml-4 flex-1 text-right text-row text-ink"
            // Native prop — cannot read the CSS variable, so it comes from the
            // mirrored JS palette.
            placeholderTextColor={palette.inkMuted}
          />
        </View>
      </LedgerSheet>

      <NumericKeypad
        onDigits={(next) => setDigits((current) => (current + next).slice(0, 9))}
        onBackspace={() => setDigits((current) => current.slice(0, -1))}
      />

      <DoubleRule />
      <Pressable
        onPress={save}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave }}
        className="h-14 items-center justify-center"
        style={({ pressed }) => ({
          opacity: !canSave ? 0.3 : pressed ? 0.5 : 1,
        })}
      >
        <Text className="font-sans-semibold text-eyebrow uppercase tracking-eyebrow text-ink">
          {addTransaction.isPending ? "Recording…" : "Record entry"}
        </Text>
      </Pressable>
    </View>
  );
}
