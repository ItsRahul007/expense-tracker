import { router } from "expo-router";
import { useMemo, useState } from "react";
import { SectionList, View } from "react-native";

import {
  DayHeader,
  EmptyState,
  Footing,
  LedgerRow,
  LedgerSheet,
  MonthSwitcher,
  ScreenHeader,
} from "@/components/ledger";
import { currentMonth, type Month } from "@/lib/month";
import { useCategories, useKnownMonths, useMonthSummary, useTransactions } from "@/queries";
import type { Transaction } from "@/types/domain";

type DaySection = {
  ts: number;
  subtotalMinor: number;
  data: Transaction[];
};

/** Groups a month's transactions into local calendar days, newest first. */
function toSections(transactions: Transaction[]): DaySection[] {
  const days = new Map<number, Transaction[]>();

  for (const tx of transactions) {
    const day = new Date(tx.occurredAt);
    day.setHours(0, 0, 0, 0);
    const key = day.getTime();
    const bucket = days.get(key);
    if (bucket) bucket.push(tx);
    else days.set(key, [tx]);
  }

  return [...days.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([ts, data]) => ({
      ts,
      data,
      subtotalMinor: data.reduce((sum, tx) => sum + tx.amountMinor, 0),
    }));
}

export default function LedgerScreen() {
  const [month, setMonth] = useState<Month>(currentMonth());

  const { data: transactions } = useTransactions(month);
  const { data: categories } = useCategories();
  const { data: summary } = useMonthSummary(month);
  const { data: knownMonths } = useKnownMonths();

  const sections = useMemo(() => toSections(transactions ?? []), [transactions]);

  /**
   * Zebra banding is keyed off a running index across the whole month rather than
   * a per-section one, so the banding stays continuous through day headings the
   * way the ruling on green-bar paper does.
   */
  const parity = useMemo(() => {
    const map = new Map<string, boolean>();
    let i = 0;
    for (const section of sections) {
      for (const tx of section.data) map.set(tx.id, i++ % 2 === 1);
    }
    return map;
  }, [sections]);

  const categoryName = useMemo(() => {
    const map = new Map((categories ?? []).map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "Uncategorised";
  }, [categories]);

  const isEmpty = transactions !== undefined && transactions.length === 0;

  return (
    <View className="flex-1 bg-paper">
      <ScreenHeader
        leading={
          <MonthSwitcher
            month={month}
            onChange={setMonth}
            earliest={knownMonths?.[0]}
          />
        }
        actions={[
          { label: "Find", onPress: () => router.push("/search") },
          { label: "+ New", onPress: () => router.push("/add") },
        ]}
      />

      <LedgerSheet>
        {isEmpty ? (
          <EmptyState message="Nothing entered for this month yet. Tap “+ New” to record the first expense." />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(tx) => tx.id}
            stickySectionHeadersEnabled
            contentContainerStyle={{ paddingBottom: 8 }}
            renderSectionHeader={({ section }) => (
              <DayHeader ts={section.ts} subtotalMinor={section.subtotalMinor} />
            )}
            renderItem={({ item }) => (
              <LedgerRow
                title={item.note?.trim() || categoryName(item.categoryId)}
                meta={item.note?.trim() ? categoryName(item.categoryId) : undefined}
                amountMinor={item.amountMinor}
                zebra={parity.get(item.id)}
                onPress={() => router.push(`/transaction/${item.id}`)}
              />
            )}
          />
        )}

        <Footing label="Month to date" amountMinor={summary?.totalMinor ?? 0} />
      </LedgerSheet>
    </View>
  );
}
