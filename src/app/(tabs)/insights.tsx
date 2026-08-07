import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import {
  Amount,
  EmptyState,
  Eyebrow,
  Footing,
  LedgerSheet,
  MonthSwitcher,
  Rule,
  ScreenHeader,
} from "@/components/ledger";
import { formatCompact } from "@/lib/format";
import { currentMonth, lastNMonths, monthLabel, type Month } from "@/lib/month";
import { useCategories, useMonthSummary, useMonthTrend } from "@/queries";
import type { ID } from "@/types/domain";

/**
 * One ink weight for every bar; length alone carries the data.
 *
 * A per-category colour set was the obvious move and the wrong one — this design
 * reserves its single accent for overspending. The first attempt instead ramped
 * ink *opacity* by rank, which looked principled and failed in practice: the
 * small categories were already short bars, and fading them too made everything
 * below fourth place invisible. Double-encoding magnitude cost legibility and
 * bought nothing, so the ramp is gone.
 */
const TREND_MONTHS = 6;

export default function InsightsScreen() {
  const [month, setMonth] = useState<Month>(currentMonth());

  const months = useMemo(() => lastNMonths(TREND_MONTHS, month), [month]);
  const { data: summary } = useMonthSummary(month);
  const { data: trend } = useMonthTrend(months);
  const { data: categories } = useCategories();

  const nameOf = (id: ID) =>
    categories?.find((c) => c.id === id)?.name ?? "Uncategorised";

  const byCategory = summary?.byCategory ?? [];
  const total = summary?.totalMinor ?? 0;
  const largest = byCategory[0]?.totalMinor ?? 0;
  const trendPeak = Math.max(1, ...(trend ?? []).map((p) => p.totalMinor));

  return (
    <View className="flex-1 bg-paper">
      <ScreenHeader
        title="Insights"
        trailing={<MonthSwitcher month={month} onChange={setMonth} />}
      />

      <LedgerSheet>
        {byCategory.length === 0 ? (
          <EmptyState message="Nothing to break down yet. Record a few entries and this fills in." />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
            <SectionLabel>Where it went</SectionLabel>

            {byCategory.map((entry) => (
              <View key={entry.categoryId}>
                <Rule />
                {/* pr-7 on the container, not pr-3 on each child: every
                    right-hand element then stops 12px clear of the rule. */}
                <View className="pb-3 pl-4 pr-7 pt-3">
                  <View className="flex-row items-baseline justify-between">
                    <Text className="font-sans-medium text-row text-ink">
                      {nameOf(entry.categoryId)}
                    </Text>
                    <Amount amountMinor={entry.totalMinor} />
                  </View>
                  <View className="flex-row items-center gap-3 pt-2">
                    <View className="h-[3px] flex-1 bg-rule/40">
                      <View
                        className="h-full bg-ink"
                        style={{
                          width: `${largest > 0 ? (entry.totalMinor / largest) * 100 : 0}%`,
                        }}
                      />
                    </View>
                    <Text className="font-mono w-9 text-right text-margin text-ink-muted">
                      {total > 0 ? Math.round((entry.totalMinor / total) * 100) : 0}%
                    </Text>
                  </View>
                </View>
              </View>
            ))}

            <SectionLabel>Last {TREND_MONTHS} months</SectionLabel>
            <Rule />
            <TrendChart
              points={trend ?? []}
              peak={trendPeak}
              activeMonth={month}
            />
          </ScrollView>
        )}

        <Footing label={`${monthLabel(month)} total`} amountMinor={total} />
      </LedgerSheet>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <View className="h-9 justify-end pb-2 pl-4">
      <Eyebrow>{children}</Eyebrow>
    </View>
  );
}

/**
 * The trend as bars hanging from a shared baseline.
 *
 * Plain Views rather than SVG — six rectangles and a baseline rule don't justify
 * a rendering dependency, and Views inherit the theme tokens directly.
 */
function TrendChart({
  points,
  peak,
  activeMonth,
}: {
  points: { month: Month; totalMinor: number }[];
  peak: number;
  activeMonth: Month;
}) {
  const HEIGHT = 96;

  return (
    <View className="pl-4 pr-7 pt-4">
      <View className="flex-row items-end justify-between" style={{ height: HEIGHT }}>
        {points.map((point) => {
          const active = point.month === activeMonth;
          return (
            <View key={point.month} className="flex-1 items-center justify-end px-1">
              <Text
                className={`font-mono pb-1 text-[10px] leading-[12px] ${
                  active ? "text-ink" : "text-ink-muted"
                }`}
              >
                {point.totalMinor > 0 ? formatCompact(point.totalMinor).replace("₹", "") : ""}
              </Text>
              <View
                className={`w-full ${active ? "bg-ink" : "bg-ink/45"}`}
                style={{
                  height: Math.max(
                    point.totalMinor > 0 ? 2 : 0,
                    (point.totalMinor / peak) * (HEIGHT - 20),
                  ),
                }}
              />
            </View>
          );
        })}
      </View>
      <Rule />
      <View className="flex-row justify-between pt-2">
        {points.map((point) => (
          <View key={point.month} className="flex-1 items-center">
            <Text
              className={`font-sans-semibold text-[10px] uppercase tracking-eyebrow ${
                point.month === activeMonth ? "text-ink" : "text-ink-muted"
              }`}
            >
              {monthLabel(point.month).slice(0, 3)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
