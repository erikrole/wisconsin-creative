/**
 * Suggests which inventory items a budget line bought, and which lines an item came from.
 * Pure scoring so it can be tested without a database. A suggestion is only a hint: an admin
 * confirms every link. Strongest signals first: exact PO or order number in the item's notes,
 * then unit price, purchase date near the line's purchase date, and shared words.
 * Reference: docs/AREA_BUDGET.md
 */

export type MatchLine = {
  description: string;
  supplier: string | null;
  unitCostCents: number;
  purchasedOn: string | null; // YYYY-MM-DD
  poNumber: string | null;
  orderNumber: string | null;
};

export type MatchItem = {
  name: string | null;
  brand: string;
  model: string;
  purchasePriceCents: number | null;
  purchaseDate: string | null; // YYYY-MM-DD
  notes: string | null;
};

export type MatchResult = {
  score: number;
  confidence: "high" | "likely" | "possible";
  reasons: string[];
};

const MIN_SUGGESTION_SCORE = 45;

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "kit", "set", "pack", "body", "new", "black", "white", "silver", "gray", "grey",
  "inch", "mm", "pro", "camera", "lens", "of", "a", "an", "to", "in", "on", "by",
]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .split(" ")
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function samePrice(a: number, b: number): "exact" | "close" | null {
  if (a === b) return "exact";
  const tolerance = Math.max(100, Math.round(Math.max(a, b) * 0.03)); // $1 or 3%
  return Math.abs(a - b) <= tolerance ? "close" : null;
}

export function scoreLineItemMatch(line: MatchLine, item: MatchItem): MatchResult | null {
  let score = 0;
  const reasons: string[] = [];

  const refs = [line.poNumber, line.orderNumber].filter((value): value is string => !!value && value.length >= 5);
  const notes = (item.notes ?? "").toLowerCase();
  const ref = refs.find((value) => notes.includes(value.toLowerCase()));
  if (ref) {
    score += 70;
    reasons.push(`Item notes mention ${ref}`);
  }

  if (item.purchasePriceCents !== null) {
    const price = samePrice(line.unitCostCents, item.purchasePriceCents);
    if (price === "exact") {
      score += 35;
      reasons.push("Same price");
    } else if (price === "close") {
      score += 20;
      reasons.push("Price within about 3%");
    }
  }

  if (line.purchasedOn && item.purchaseDate) {
    const days = daysBetween(line.purchasedOn, item.purchaseDate);
    if (days <= 14) {
      score += 25;
      reasons.push(days === 0 ? "Same purchase date" : `Bought ${Math.round(days)} days apart`);
    } else if (days <= 60) {
      score += 10;
      reasons.push(`Bought ${Math.round(days)} days apart`);
    }
  }

  const lineWords = new Set(tokens(`${line.description} ${line.supplier ?? ""}`));
  const itemWords = new Set(tokens(`${item.brand} ${item.model} ${item.name ?? ""}`));
  const shared = [...itemWords].filter((word) => lineWords.has(word));
  if (itemWords.size > 0 && shared.length > 0) {
    const coverage = shared.length / itemWords.size;
    const points = Math.round(Math.min(40, 15 + coverage * 30));
    score += points;
    reasons.push(`Shared words: ${shared.slice(0, 4).join(", ")}`);
  }

  if (score < MIN_SUGGESTION_SCORE) return null;
  return {
    score,
    confidence: score >= 90 ? "high" : score >= 65 ? "likely" : "possible",
    reasons,
  };
}
