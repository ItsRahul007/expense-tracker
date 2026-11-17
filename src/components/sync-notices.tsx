/**
 * Sync news that needs the user, shown at the top of Home:
 *  - "Merged 1 duplicate from your other phone · Undo"  (design §12.7)
 *  - "Possible duplicates" — same expense entered hours apart while one phone
 *    was offline; the user decides Merge or Keep both  (design §12.9 B)
 *  - a nudge when the backup needs attention (reconnect, deleted sheet, review)
 *
 * Renders nothing in the normal case.
 */
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Card } from "@/components/ui";
import { usePalette } from "@/constants/palette";
import { formatMoney, formatRelativeDay, formatTime } from "@/lib/format";
import { useSync } from "@/providers/sync-provider";
import { useCategories } from "@/queries";
import type { DuplicateSuggestion } from "@/sync/dedupe";
import type { TransactionRecord } from "@/sync/types";

function Pill({ label, onPress, tone = "default" }: { label: string; onPress: () => void; tone?: "default" | "brand" }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      hitSlop={6}
      className={`rounded-full px-3 py-1.5 active:opacity-60 ${tone === "brand" ? "bg-brand" : "border border-border bg-card"}`}
    >
      <Text className={`font-sans-semibold text-label ${tone === "brand" ? "text-white" : "text-fg"}`}>{label}</Text>
    </Pressable>
  );
}

function EntryLine({ entry, label }: { entry: TransactionRecord; label: string }) {
  return (
    <View className="mt-2">
      <Text className="font-sans-medium text-body text-fg" numberOfLines={1}>
        {entry.note?.trim() || "No note"}
      </Text>
      <Text className="font-sans text-label text-muted">
        {label} · entered {formatRelativeDay(entry.createdAt).toLowerCase()} {formatTime(entry.createdAt)}
      </Text>
    </View>
  );
}

function SuggestionCard({ suggestion }: { suggestion: DuplicateSuggestion }) {
  const { resolveSuggestion } = useSync();
  const { data: categories } = useCategories();
  const [choosingNote, setChoosingNote] = useState(false);
  const { a, b } = suggestion;
  const category = categories?.find((c) => c.id === a.categoryId)?.name ?? "Expense";
  const notesDiffer = (a.note ?? "") !== (b.note ?? "") && !!a.note && !!b.note;

  const merge = (keepNoteFrom: string) => resolveSuggestion(suggestion, { merge: true, keepNoteFrom });

  return (
    <Card>
      <Text className="font-sans-semibold text-headline text-fg">Possible duplicate</Text>
      <Text className="font-sans mt-1 text-label text-muted">
        {formatMoney(a.amountMinor)} · {category} · {formatRelativeDay(a.occurredAt)} — entered twice, on two
        phones, one of them offline.
      </Text>
      <EntryLine entry={a} label="First" />
      <EntryLine entry={b} label="Second" />

      {choosingNote ? (
        <View className="mt-3 flex-row flex-wrap gap-2">
          <Text className="font-sans w-full text-label text-muted">Keep which note?</Text>
          <Pill label={`“${a.note}”`} onPress={() => merge(a.id)} />
          <Pill label={`“${b.note}”`} onPress={() => merge(b.id)} />
        </View>
      ) : (
        <View className="mt-3 flex-row gap-2">
          <Pill
            tone="brand"
            label="Same expense — merge"
            onPress={() => (notesDiffer ? setChoosingNote(true) : merge(a.note ? a.id : b.id))}
          />
          <Pill label="Keep both" onPress={() => resolveSuggestion(suggestion, { merge: false })} />
        </View>
      )}
    </Card>
  );
}

export function SyncNotices() {
  const palette = usePalette();
  const { status, undoMerges, dismissMerges } = useSync();

  const attention =
    status.pendingReview ||
    (status.lastError && !["offline", "rate_limited", "server"].includes(status.lastError.code));

  if (!status.recentMerges.length && !status.suggestions.length && !attention) return null;

  return (
    <View className="mb-4 gap-3">
      {attention ? (
        <Pressable onPress={() => router.push("/account")} accessibilityRole="button" className="active:opacity-70">
          <View className="flex-row items-center gap-3 rounded-2xl bg-danger/10 px-4 py-3">
            <Ionicons name="cloud-offline-outline" size={20} color={palette.danger} />
            <Text className="font-sans-medium flex-1 text-body text-danger">
              {status.pendingReview ? "A big change from another device needs your review" : "Backup needs your attention"}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={palette.danger} />
          </View>
        </Pressable>
      ) : null}

      {status.recentMerges.length ? (
        <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <Ionicons name="git-merge-outline" size={20} color={palette.brand} />
          <Text className="font-sans flex-1 text-label text-fg">
            Merged {status.recentMerges.length} duplicate expense{status.recentMerges.length === 1 ? "" : "s"} from
            your other device
          </Text>
          <Pill label="Undo" onPress={undoMerges} />
          <Pressable onPress={dismissMerges} accessibilityLabel="Dismiss" hitSlop={10}>
            <Ionicons name="close" size={18} color={palette.muted} />
          </Pressable>
        </View>
      ) : null}

      {status.suggestions.map((suggestion) => (
        <SuggestionCard key={`${suggestion.a.id}|${suggestion.b.id}`} suggestion={suggestion} />
      ))}
    </View>
  );
}
