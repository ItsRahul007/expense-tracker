import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import {
  Card,
  EmptyState,
  IconBadge,
  MonthSwitcher,
  Progress,
  ScreenHeader,
  SectionTitle,
} from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { currentMonth, lastNMonths, monthShort, type Month } from "@/lib/month";
import { useCategories, useMonthSummary, useMonthTrend } from "@/queries";
import type { Category, ID } from "@/types/domain";

const TREND_MONTHS = 6;

export default function StatsScreen() {
  const [month, setMonth] = useState<Month>(currentMonth());

  const months = useMemo(() => lastNMonths(TREND_MONTHS, month), [month]);
  const { data: summary } = useMonthSummary(month);
  const { data: trend } = useMonthTrend(months);
  const { data: categories } = useCategories();

  const categoryById = useMemo(() => {
    const map = new Map<ID, Category>();
    for (const category of categories ?? []) map.set(category.id, category);
    return map;
  }, [categories]);

  const byCategory = summary?.byCategory ?? [];
  const total = summary?.totalMinor ?? 0;
  const largest = byCategory[0]?.totalMinor ?? 0;
  const trendPeak = Math.max(1, ...(trend ?? []).map((p) => p.totalMinor));

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Stats" />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="pb-4">
          <MonthSwitcher month={month} onChange={setMonth} />
        </View>

        {byCategory.length === 0 ? (
          <EmptyState
            icon="stats-chart-outline"
            title="Nothing to show yet"
            body="Record a few expenses and the breakdown appears here."
          />
        ) : (
          <>
            <Card>
              <Text className="font-sans-medium text-label text-muted">
                Total spent
              </Text>
              <Text className="font-sans-bold mt-1 text-display text-fg">
                {formatMoney(total, { paise: false })}
              </Text>
            </Card>

            <View className="mt-6">
              <SectionTitle title="By category" />
              <Card padded={false} className="px-4 py-1">
                {byCategory.map((entry) => {
                  const category = categoryById.get(entry.categoryId);
                  const share = total > 0 ? entry.totalMinor / total : 0;

                  return (
                    <View key={entry.categoryId} className="py-3">
                      <View className="flex-row items-center gap-3">
                        <IconBadge
                          icon={category?.icon ?? "ellipsis-horizontal"}
                          color={category?.color ?? "#6B7280"}
                          size="sm"
                        />
                        <Text className="font-sans-medium flex-1 text-body text-fg">
                          {category?.name ?? "Uncategorised"}
                        </Text>
                        <Text className="font-sans-semibold text-body text-fg">
                          {formatMoney(entry.totalMinor)}
                        </Text>
                      </View>

                      <View className="mt-2.5 flex-row items-center gap-3">
                        {/* Bar length is share of the largest category so the
                            top row fills the width; the percentage beside it is
                            share of the month, which is the useful number. */}
                        <View className="flex-1">
                          <Progress
                            fraction={largest > 0 ? entry.totalMinor / largest : 0}
                            tint={category?.color}
                            height={6}
                          />
                        </View>
                        <Text className="font-sans-medium w-9 text-right text-label text-muted">
                          {Math.round(share * 100)}%
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </Card>
            </View>

            <View className="mt-6">
              <SectionTitle title={`Last ${TREND_MONTHS} months`} />
              <Card>
                <TrendChart
                  points={trend ?? []}
                  peak={trendPeak}
                  activeMonth={month}
                />
              </Card>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Bars from a shared baseline. Plain Views rather than SVG — six rectangles
 * don't justify a rendering dependency, and Views inherit the theme tokens.
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
  const HEIGHT = 110;

  return (
    <View>
      <View className="flex-row items-end justify-between" style={{ height: HEIGHT }}>
        {points.map((point) => {
          const active = point.month === activeMonth;
          return (
            <View key={point.month} className="flex-1 items-center justify-end px-1">
              <Text
                className={`font-sans-medium pb-1.5 text-caption ${
                  active ? "text-fg" : "text-muted"
                }`}
              >
                {point.totalMinor > 0
                  ? formatMoney(Math.round(point.totalMinor / 100) * 100)
                  : ""}
              </Text>
              <View
                className={`w-full rounded-lg ${active ? "bg-accent" : "bg-accent/25"}`}
                style={{
                  height: Math.max(
                    point.totalMinor > 0 ? 4 : 0,
                    (point.totalMinor / peak) * (HEIGHT - 26),
                  ),
                }}
              />
            </View>
          );
        })}
      </View>

      <View className="mt-2 flex-row justify-between">
        {points.map((point) => (
          <View key={point.month} className="flex-1 items-center">
            <Text
              className={`font-sans-medium text-caption ${
                point.month === activeMonth ? "text-fg" : "text-muted"
              }`}
            >
              {monthShort(point.month)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
