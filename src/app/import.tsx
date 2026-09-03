import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";

import {
  Button,
  Card,
  Chip,
  IconBadge,
  ScreenHeader,
  SectionTitle,
} from "@/components/ui";
import { usePalette } from "@/constants/palette";
import {
  buildImportRequest,
  parseLedgerCsv,
  planImport,
  type ImportPlan,
  type ImportedRow,
  type SkippedRow,
} from "@/lib/csv-import";
import { formatMoney, formatRelativeDay } from "@/lib/format";
import { monthLabel, monthOf } from "@/lib/month";
import { useCategories, useImportTransactions, useTransactions } from "@/queries";
import type { NewTransaction } from "@/types/domain";

/**
 * The CSV import: pick a file, see exactly what's in it, then save.
 *
 * The preview step isn't ceremony. This app has no undo, imports arrive in the
 * hundreds, and the two things most likely to go wrong — a date column read the
 * wrong way round, or a file imported twice — are both invisible until the
 * damage is in the ledger. So every decision the parser made is on screen and
 * reversible before anything is written: which rows it took, which it couldn't,
 * which are already recorded, and which categories it would create.
 *
 * Everything up to the confirm button is pure (`src/lib/csv-import.ts`) and
 * touches no database. The write itself is one transaction — see
 * `useImportTransactions`.
 */

/**
 * The MIME types offered to the picker.
 *
 * Broader than "text/csv" because the same file arrives under different types
 * depending on where it came from: our own export is text/csv, a spreadsheet's
 * is often application/vnd.ms-excel, and one saved out of a mail client can be
 * text/plain. A file whose type isn't in this list can't be selected at all, so
 * the list errs wide — anything unreadable is caught on parse and explained.
 */
const CSV_TYPES = [
  "text/csv",
  "text/comma-separated-values",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
];

/** Read whole into memory and parsed on the JS thread, so there's a ceiling.
 *  4 MB is around forty thousand expenses — far past any real ledger. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Months named in full on the success card before it starts counting instead. */
const MONTHS_NAMED = 3;

/** Enough skipped rows to see the pattern, not so many that the list becomes
 *  the screen. The count above it always states the true total. */
const SKIPPED_SHOWN = 6;

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  /** The file couldn't be read or understood at all — nothing to preview. */
  | { kind: "failed"; message: string }
  | { kind: "ready"; fileName: string; rows: ImportedRow[]; skipped: SkippedRow[] }
  | { kind: "done"; summary: Summary };

type Summary = {
  added: number;
  categoriesCreated: number;
  duplicatesSkipped: number;
  unreadable: number;
  months: string[];
};

export default function ImportScreen() {
  const palette = usePalette();
  const { data: categories } = useCategories();
  const { data: existing } = useTransactions(null);
  const importTransactions = useImportTransactions();

  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [includeDuplicates, setIncludeDuplicates] = useState(false);

  /**
   * The plan is derived rather than stored, so it can't go stale against the
   * categories and transactions the queries hold. `stage.rows` is the only
   * thing the file itself contributes.
   */
  const plan: ImportPlan | null = useMemo(() => {
    if (stage.kind !== "ready") return null;
    return planImport({
      rows: stage.rows,
      skipped: stage.skipped,
      categories: categories ?? [],
      existing: existing ?? [],
    });
  }, [stage, categories, existing]);

  const duplicates = plan?.entries.filter((entry) => entry.duplicate).length ?? 0;
  const request = plan ? buildImportRequest(plan, includeDuplicates) : null;
  const importing = request?.transactions.length ?? 0;

  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: CSV_TYPES,
      // Android hands back a content:// URI that only the picker can read;
      // copying it into the cache is what makes `File` below work on both.
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    setStage({ kind: "reading" });
    setIncludeDuplicates(false);

    if ((asset.size ?? 0) > MAX_FILE_BYTES) {
      setStage({
        kind: "failed",
        message: "That file is bigger than 4 MB. Split it into a few smaller ones and import them one at a time.",
      });
      return;
    }

    try {
      const text = await new File(asset.uri).text();
      const parsed = parseLedgerCsv(text);

      if (!parsed.ok) {
        setStage({ kind: "failed", message: parsed.error });
        return;
      }
      // Note that zero readable rows is *not* a failure: the preview's skipped
      // list is the only place someone can find out why, so it has to render.
      setStage({
        kind: "ready",
        fileName: asset.name,
        rows: parsed.rows,
        skipped: parsed.skipped,
      });
    } catch (error) {
      setStage({
        kind: "failed",
        message:
          error instanceof Error
            ? `That file couldn’t be opened — ${error.message}`
            : "That file couldn’t be opened.",
      });
    }
  };

  const confirm = async () => {
    if (!plan || !request || request.transactions.length === 0) return;

    try {
      await importTransactions.mutateAsync(request);
    } catch {
      // Rendered from `importTransactions.error` below. Caught so the screen
      // stays on the preview with the file still loaded — the import is
      // all-or-nothing, so trying again is safe.
      return;
    }

    setStage({
      kind: "done",
      summary: {
        added: request.transactions.length,
        categoriesCreated: request.categories.length,
        duplicatesSkipped: includeDuplicates ? 0 : duplicates,
        unreadable: plan.skipped.length,
        months: monthsCovered(request.transactions),
      },
    });
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Import CSV"
        subtitle={stage.kind === "done" ? undefined : "Nothing is saved until you confirm"}
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {stage.kind === "idle" || stage.kind === "failed" ? (
          <>
            {stage.kind === "failed" ? (
              <Card className="mb-4 border-danger/40">
                <View className="flex-row items-start gap-3">
                  <IconBadge icon="alert-circle-outline" color={palette.danger} />
                  <Text className="font-sans mt-1.5 flex-1 text-body text-fg">
                    {stage.message}
                  </Text>
                </View>
              </Card>
            ) : null}

            <FormatCard />

            <View className="mt-6">
              <Button
                label={stage.kind === "failed" ? "Choose another file" : "Choose a file"}
                onPress={pick}
              />
            </View>
          </>
        ) : null}

        {stage.kind === "reading" ? (
          <Card>
            <Text className="font-sans text-body text-muted">Reading the file…</Text>
          </Card>
        ) : null}

        {stage.kind === "ready" && plan ? (
          <>
            <Card>
              <View className="flex-row items-center gap-3">
                <IconBadge icon="document-text-outline" color={palette.accent} />
                <View className="flex-1">
                  <Text
                    className="font-sans-semibold text-body text-fg"
                    numberOfLines={1}
                  >
                    {stage.fileName}
                  </Text>
                  <Text className="font-sans text-label text-muted">
                    {countLabel(plan.entries.length + plan.skipped.length, "row", "rows")}{" "}
                    read
                  </Text>
                </View>
              </View>

              <View className="mt-4 border-t border-border pt-4">
                <Text className="font-sans-bold text-title text-fg">
                  {importing === 0
                    ? "Nothing to import"
                    : `${countLabel(importing, "expense", "expenses")} ready`}
                </Text>
                <Text className="font-sans mt-0.5 text-body text-muted">
                  {importing > 0 && request
                    ? `${formatMoney(totalOf(request.transactions))} · ${rangeLabel(request.transactions)}`
                    : plan.entries.length > 0
                      // The likeliest way to land here by far: the same file
                      // imported a second time. Saying so beats "nothing could
                      // be read", which would be plainly untrue.
                      ? "Every row in this file is already recorded."
                      : "Nothing in this file could be read as an expense — the rows below say why."}
                </Text>
              </View>
            </Card>

            {request && request.categories.length > 0 ? (
              <View className="mt-6">
                <SectionTitle title="New categories" />
                <Card padded={false} className="overflow-hidden">
                  {request.categories.map((category, index) => (
                    <View key={category.id}>
                      <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-3">
                        <IconBadge
                          icon={category.icon}
                          color={category.color}
                          size="sm"
                        />
                        <Text className="font-sans-medium flex-1 text-body text-fg">
                          {category.name}
                        </Text>
                      </View>
                      {index < request.categories.length - 1 ? (
                        <View className="ml-[52px] h-px bg-border" />
                      ) : null}
                    </View>
                  ))}
                </Card>
                <Text className="font-sans mt-2 px-1 text-label text-muted">
                  These aren’t in your list yet, so importing creates them. Give them a
                  proper icon and colour afterwards on the Categories screen.
                </Text>
              </View>
            ) : null}

            {duplicates > 0 ? (
              <View className="mt-6">
                <SectionTitle title="Already recorded" />
                <Card>
                  <Text className="font-sans text-body text-fg">
                    {countLabel(duplicates, "row", "rows")} in this file{" "}
                    {duplicates === 1 ? "matches an expense" : "match expenses"} you
                    already have — same day, category, amount and note.
                  </Text>
                  <View className="mt-3 flex-row gap-2">
                    <Chip
                      label="Skip them"
                      selected={!includeDuplicates}
                      onPress={() => setIncludeDuplicates(false)}
                    />
                    <Chip
                      label="Import anyway"
                      selected={includeDuplicates}
                      onPress={() => setIncludeDuplicates(true)}
                    />
                  </View>
                  {includeDuplicates ? (
                    <Text className="font-sans mt-3 text-label text-muted">
                      They’ll be added a second time. Right if you really did spend it
                      twice.
                    </Text>
                  ) : null}
                </Card>
              </View>
            ) : null}

            {plan.skipped.length > 0 ? (
              <View className="mt-6">
                <SectionTitle title="Couldn’t be read" />
                <Card padded={false} className="overflow-hidden">
                  {plan.skipped.slice(0, SKIPPED_SHOWN).map((skip, index) => (
                    <View key={skip.row}>
                      <View className="flex-row items-baseline gap-3 px-4 py-3">
                        <Text className="font-sans-medium text-label text-muted">
                          Row {skip.row}
                        </Text>
                        <Text className="font-sans flex-1 text-label text-fg">
                          {skip.reason}
                        </Text>
                      </View>
                      {index < Math.min(plan.skipped.length, SKIPPED_SHOWN) - 1 ? (
                        <View className="ml-4 h-px bg-border" />
                      ) : null}
                    </View>
                  ))}
                </Card>
                <Text className="font-sans mt-2 px-1 text-label text-muted">
                  {plan.skipped.length > SKIPPED_SHOWN
                    ? `${plan.skipped.length - SKIPPED_SHOWN} more like this. They're left out; `
                    : "They’re left out; "}
                  fix them in the file and import it again — anything already brought in
                  will be recognised and skipped.
                </Text>
              </View>
            ) : null}

            <View className="mt-8 gap-3">
              <Button
                label={
                  importing === 0
                    ? "Nothing to import"
                    : `Import ${countLabel(importing, "expense", "expenses")}`
                }
                onPress={confirm}
                disabled={importing === 0}
                loading={importTransactions.isPending}
              />
              <Button
                label="Choose another file"
                variant="secondary"
                onPress={pick}
              />
            </View>

            {importTransactions.error ? (
              <Text className="font-sans mt-4 px-1 text-center text-label text-danger">
                Nothing was saved — {importTransactions.error.message}
              </Text>
            ) : null}
          </>
        ) : null}

        {stage.kind === "done" ? (
          <DoneCard summary={stage.summary} onClose={() => router.back()} />
        ) : null}
      </ScrollView>
    </View>
  );
}

/** What the importer expects, shown before the picker rather than after a
 *  failure — the format is easy to get right and annoying to guess. */
function FormatCard() {
  return (
    <Card>
      <Text className="font-sans-semibold text-headline text-fg">
        A row per expense
      </Text>
      <Text className="font-sans mt-1.5 text-body text-muted">
        Four columns: the date, the category, the amount and an optional note.
      </Text>

      <View className="mt-4 rounded-xl border border-border bg-bg p-3">
        {["Date,Category,Amount,Note", "2026-08-05,Food,240.50,Lunch", "2026-08-06,Transport,60,Auto"].map(
          (line, index) => (
            <Text
              key={line}
              // Monospace so the commas line up — this is a file, and it should
              // look like one.
              style={{ fontFamily: MONO, fontSize: 11, lineHeight: 18 }}
              className={index === 0 ? "text-fg" : "text-muted"}
            >
              {line}
            </Text>
          ),
        )}
      </View>

      <Text className="font-sans mt-3 text-label text-muted">
        A file exported from this app goes straight back in. Dates can also be
        05/08/2026 or 5 Aug 2026, amounts can carry ₹ and commas, and a category
        that doesn’t exist yet will be created.
      </Text>
    </Card>
  );
}

/**
 * The result, stated in full.
 *
 * The months matter more than they look: Home opens on the current month, so an
 * import of older expenses lands somewhere the user isn't looking. Naming the
 * months is what turns "did that work?" into a place to go.
 */
function DoneCard({ summary, onClose }: { summary: Summary; onClose: () => void }) {
  const palette = usePalette();
  const { added, categoriesCreated, duplicatesSkipped, unreadable, months } = summary;

  return (
    <>
      <Card>
        <View className="flex-row items-center gap-3">
          <IconBadge icon="checkmark-circle-outline" color={palette.success} />
          <View className="flex-1">
            <Text className="font-sans-bold text-title text-fg">
              {countLabel(added, "expense", "expenses")} imported
            </Text>
            {months.length > 0 ? (
              <Text className="font-sans mt-0.5 text-body text-muted">
                Filed under {joinWords(months)}
              </Text>
            ) : null}
          </View>
        </View>

        {categoriesCreated > 0 || duplicatesSkipped > 0 || unreadable > 0 ? (
          <View className="mt-4 gap-1.5 border-t border-border pt-4">
            {categoriesCreated > 0 ? (
              <Text className="font-sans text-label text-muted">
                {countLabel(categoriesCreated, "category", "categories")} created
              </Text>
            ) : null}
            {duplicatesSkipped > 0 ? (
              <Text className="font-sans text-label text-muted">
                {countLabel(duplicatesSkipped, "row", "rows")} skipped as already
                recorded
              </Text>
            ) : null}
            {unreadable > 0 ? (
              <Text className="font-sans text-label text-muted">
                {countLabel(unreadable, "row", "rows")} couldn’t be read
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      <Text className="font-sans mt-4 px-1 text-label text-muted">
        {months.length > 1
          ? "Use the month switcher on Expenses to see each month."
          : "Open Expenses to see them."}
      </Text>

      <View className="mt-6">
        <Button label="Done" onPress={onClose} />
      </View>
    </>
  );
}

// --- small formatting helpers ------------------------------------------------

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function totalOf(transactions: NewTransaction[]): number {
  return transactions.reduce((sum, tx) => sum + tx.amountMinor, 0);
}

/**
 * "5 Jul – 31 Aug", or the single day when that's all there is.
 *
 * Folded rather than `Math.min(...times)`: the spread passes one argument per
 * row, and a few tens of thousands of them overflows the call stack — which a
 * file this screen is happy to accept can reach.
 */
function rangeLabel(transactions: NewTransaction[]): string {
  let earliest = transactions[0].occurredAt;
  let latest = earliest;
  for (const tx of transactions) {
    if (tx.occurredAt < earliest) earliest = tx.occurredAt;
    if (tx.occurredAt > latest) latest = tx.occurredAt;
  }

  const first = formatRelativeDay(earliest);
  const last = formatRelativeDay(latest);
  return first === last ? first : `${first} – ${last}`;
}

/** The months the import touches, oldest first, as readable labels. */
function monthsCovered(transactions: NewTransaction[]): string[] {
  const months = new Set(transactions.map((tx) => monthOf(tx.occurredAt)));
  return [...months].sort().map(monthLabel);
}

/** "August 2026 and July 2026", trailing off at three so a two-year import
 *  doesn't turn the line into a paragraph. */
function joinWords(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length > MONTHS_NAMED) {
    return `${values.slice(0, MONTHS_NAMED).join(", ")} and ${values.length - MONTHS_NAMED} more`;
  }
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
