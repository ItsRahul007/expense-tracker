/**
 * In-memory stand-in for the SQLite layer.
 *
 * Exists so every screen is real and clickable before the Drizzle layer lands.
 * It is intentionally free of any TanStack Query or expo-sqlite dependency —
 * it only has to satisfy the shapes in `src/types/domain.ts`.
 *
 * Nothing outside `src/queries/` should import this file. When `live.ts` is
 * ready, `src/queries/index.ts` switches over and this can be deleted.
 */

import { lastNMonths, monthOf } from "@/lib/month";
import type {
  Budget,
  Category,
  ID,
  NewTransaction,
  Settings,
  Transaction,
  TransactionPatch,
} from "@/types/domain";

/** Seeded LCG so the fixture set is identical on every reload. Comparing two
 *  screenshots is impossible if the data reshuffles underneath you. */
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const CATEGORIES: Category[] = [
  { id: "c-food", name: "Food & Drink", code: "FOOD", sortOrder: 0 },
  { id: "c-groc", name: "Groceries", code: "GROC", sortOrder: 1 },
  { id: "c-trvl", name: "Transport", code: "TRVL", sortOrder: 2 },
  { id: "c-home", name: "Rent & Bills", code: "HOME", sortOrder: 3 },
  { id: "c-hlth", name: "Health", code: "HLTH", sortOrder: 4 },
  { id: "c-shop", name: "Shopping", code: "SHOP", sortOrder: 5 },
  { id: "c-entm", name: "Entertainment", code: "ENTM", sortOrder: 6 },
  { id: "c-misc", name: "Other", code: "MISC", sortOrder: 7 },
];

/** Plausible merchants and paise ranges, so the ledger reads like a real month
 *  rather than lorem ipsum — spacing problems only show up with real strings. */
const SPEND: Record<ID, { notes: string[]; min: number; max: number }> = {
  "c-food": {
    notes: ["Chai stall", "Rolls corner", "Third Wave Coffee", "Swiggy", "Meghana Foods", "Office canteen"],
    min: 2_000, max: 85_000,
  },
  "c-groc": {
    notes: ["Blue Mart", "BigBasket", "Local kirana", "Nature's Basket"],
    min: 18_000, max: 340_000,
  },
  "c-trvl": {
    notes: ["Metro", "Auto", "Uber", "Rapido", "Petrol"],
    min: 2_500, max: 95_000,
  },
  "c-hlth": {
    notes: ["Apollo Pharmacy", "Cult.fit", "Consultation", "Practo"],
    min: 15_000, max: 250_000,
  },
  "c-shop": {
    notes: ["Amazon", "Decathlon", "Myntra", "Croma"],
    min: 45_000, max: 890_000,
  },
  "c-entm": {
    notes: ["PVR", "BookMyShow", "Steam", "Concert ticket"],
    min: 20_000, max: 180_000,
  },
  "c-misc": {
    notes: ["Haircut", "Gift", "Repair", "Donation"],
    min: 10_000, max: 200_000,
  },
};

/** Charged on a fixed day each month — gives the trend chart a stable floor and
 *  the ledger some large figures to stress the alignment rule against. */
const FIXED: { day: number; categoryId: ID; note: string; amountMinor: number }[] = [
  { day: 1, categoryId: "c-home", note: "Rent", amountMinor: 1_840_000 },
  { day: 3, categoryId: "c-entm", note: "Netflix", amountMinor: 64_900 },
  { day: 3, categoryId: "c-entm", note: "Spotify", amountMinor: 11_900 },
  { day: 5, categoryId: "c-home", note: "Airtel Fiber", amountMinor: 115_000 },
  { day: 8, categoryId: "c-home", note: "Electricity", amountMinor: 218_450 },
];

let idCounter = 0;
const nextId = () => `t-${++idCounter}`;

function seedTransactions(): Transaction[] {
  const rng = makeRng(20260805);
  const rows: Transaction[] = [];
  const months = lastNMonths(6);
  const now = Date.now();

  for (const month of months) {
    const [year, m] = month.split("-").map(Number);

    for (const f of FIXED) {
      const at = new Date(year, m - 1, f.day, 10, 30).getTime();
      if (at <= now) {
        rows.push({ id: nextId(), amountMinor: f.amountMinor, categoryId: f.categoryId, occurredAt: at, note: f.note });
      }
    }

    const daysInMonth = new Date(year, m, 0).getDate();
    const variable = Object.keys(SPEND);

    for (let day = 1; day <= daysInMonth; day++) {
      const count = rng() < 0.22 ? 0 : 1 + Math.floor(rng() * 3);
      for (let i = 0; i < count; i++) {
        const categoryId = variable[Math.floor(rng() * variable.length)];
        const spec = SPEND[categoryId];
        const at = new Date(year, m - 1, day, 8 + Math.floor(rng() * 13), Math.floor(rng() * 60)).getTime();
        if (at > now) continue;
        // Round to the nearest rupee most of the time; leave some paise behind
        // so the muted decimal column is actually exercised.
        const raw = spec.min + rng() * (spec.max - spec.min);
        const amountMinor = rng() < 0.75 ? Math.round(raw / 100) * 100 : Math.round(raw);
        rows.push({
          id: nextId(),
          amountMinor: Math.max(100, amountMinor),
          categoryId,
          occurredAt: at,
          note: spec.notes[Math.floor(rng() * spec.notes.length)],
        });
      }
    }
  }

  return rows.sort((a, b) => b.occurredAt - a.occurredAt);
}

function seedBudgets(): Budget[] {
  const month = monthOf(Date.now());
  return [
    { categoryId: "c-food", month, limitMinor: 800_000 },
    { categoryId: "c-groc", month, limitMinor: 1_200_000 },
    { categoryId: "c-trvl", month, limitMinor: 400_000 },
    { categoryId: "c-home", month, limitMinor: 2_500_000 },
    { categoryId: "c-shop", month, limitMinor: 600_000 },
    { categoryId: "c-entm", month, limitMinor: 200_000 },
  ];
}

export type MockState = {
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  settings: Settings;
};

let state: MockState = {
  categories: CATEGORIES,
  transactions: seedTransactions(),
  budgets: seedBudgets(),
  settings: { theme: "system" },
};

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): MockState {
  return state;
}

function commit(next: Partial<MockState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

// --- commands ---------------------------------------------------------------

export function addTransaction(input: NewTransaction) {
  commit({
    transactions: [{ ...input, id: nextId() }, ...state.transactions].sort(
      (a, b) => b.occurredAt - a.occurredAt,
    ),
  });
}

export function updateTransaction(patch: TransactionPatch) {
  commit({
    transactions: state.transactions
      .map((t) => (t.id === patch.id ? { ...t, ...patch } : t))
      .sort((a, b) => b.occurredAt - a.occurredAt),
  });
}

export function deleteTransaction(id: ID) {
  commit({ transactions: state.transactions.filter((t) => t.id !== id) });
}

export function upsertBudget(budget: Budget) {
  const rest = state.budgets.filter(
    (b) => !(b.categoryId === budget.categoryId && b.month === budget.month),
  );
  commit({ budgets: budget.limitMinor > 0 ? [...rest, budget] : rest });
}

export function upsertCategory(category: Category) {
  const existing = state.categories.some((c) => c.id === category.id);
  commit({
    categories: (existing
      ? state.categories.map((c) => (c.id === category.id ? category : c))
      : [...state.categories, category]
    ).sort((a, b) => a.sortOrder - b.sortOrder),
  });
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  commit({ settings: { ...state.settings, [key]: value } });
}
