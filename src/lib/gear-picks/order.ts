import { GEAR_ONE_SIZE, findGearSku, gearSku, normalizeApparelSize, type GearPickFitKey } from "./catalog";
import type { GearPicksAdminResponse } from "./types";

export type OrderSource = "STANDARD_ISSUE" | "CORE_KIT" | "STUDENT_KIT" | "PICK";

export type OrderLine = {
  sku: string;
  itemName: string;
  colorLabel: string;
  source: OrderSource;
  /** Quantity per size, ordered by first appearance. "Size needed" collects people with no size on file. */
  sizes: { size: string; quantity: number }[];
  quantity: number;
  /** Team price for the whole line. Kits are covered by the department but still ordered. */
  totalCents: number;
};

export type OrderPlan = {
  lines: OrderLine[];
  pieces: number;
  /** Dollars on picks that come out of the budget. */
  pickCents: number;
  /** People whose kit pieces have no size on file yet. */
  missingSizePeople: string[];
  /** Students on the roster. Each also gets a shoe, but the style is not chosen yet. */
  studentShoes: number;
};

/** Student kit: CW Momentum 1/4 Zip ($52.50) and Drive Polo ($40.00), both in Red (834). */
export const STUDENT_KIT_SKUS = {
  MEN: ["6021673-834", "6021712-834"],
  WOMEN: ["6021680-834", "6021715-834"],
} as const;

export const SIZE_NEEDED = "Size needed";

const SOURCE_ORDER: Record<OrderSource, number> = { STANDARD_ISSUE: 0, CORE_KIT: 1, STUDENT_KIT: 2, PICK: 3 };

/**
 * Roll staff kits and picks up into one quantity per item, color and size. Standard issue and core kit
 * come from each person's fit and profile sizes; picks come from their saved lists; students get the
 * zip and polo. The student shoe is only counted, since its style is not chosen.
 */
export function buildOrderPlan(
  participants: GearPicksAdminResponse["participants"],
  kits: Record<GearPickFitKey, { kind: "STANDARD_ISSUE" | "CORE_KIT"; style: string; code: string; name: string }[]>,
  students: GearPicksAdminResponse["students"] = [],
): OrderPlan {
  const lines = new Map<string, OrderLine>();
  const missing = new Set<string>();

  const add = (source: OrderSource, sku: string, size: string, quantity: number, unitPriceCents: number, kitName?: string) => {
    const found = findGearSku(sku);
    const key = `${source}|${sku}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        sku,
        itemName: `${found?.item.name ?? kitName ?? sku}${found?.item.fit === "WOMEN" ? " (women’s)" : ""}`,
        colorLabel: found?.color.label ?? "",
        source,
        sizes: [],
        quantity: 0,
        totalCents: 0,
      };
      lines.set(key, line);
    }
    const entry = line.sizes.find((candidate) => candidate.size === size);
    if (entry) entry.quantity += quantity;
    else line.sizes.push({ size, quantity });
    line.quantity += quantity;
    line.totalCents += unitPriceCents * quantity;
  };

  let pickCents = 0;
  for (const person of participants) {
    for (const entry of kits[person.fit] ?? []) {
      const sku = gearSku(entry.style, entry.code);
      const found = findGearSku(sku);
      // Kit-only styles (the standard-issue shoe) are not in the shop catalog, so fall back to the name.
      const kind = found?.sizeKind ?? (/shoe/i.test(entry.name) ? "FOOTWEAR" : "APPAREL");
      const size =
        kind === "HEADWEAR"
          ? GEAR_ONE_SIZE
          : kind === "FOOTWEAR"
            ? (person.user.shoeSize ?? null)
            : normalizeApparelSize(person.user.topSize);
      if (!size) missing.add(person.user.name);
      add(entry.kind, sku, size ?? SIZE_NEEDED, 1, found?.unitPriceCents ?? 0, entry.name);
    }
    for (const line of person.submission?.lines ?? []) {
      add("PICK", line.sku, line.size ?? GEAR_ONE_SIZE, line.quantity, line.unitPriceCents);
      pickCents += line.lineTotalCents;
    }
  }

  // Students are fitted from their profile; unisex or no fit falls back to the men's cut.
  for (const student of students) {
    const fit: GearPickFitKey = student.topSizeFit === "WOMENS" ? "WOMEN" : "MEN";
    const size = normalizeApparelSize(student.topSize);
    if (!size) missing.add(student.user.name);
    for (const sku of STUDENT_KIT_SKUS[fit]) add("STUDENT_KIT", sku, size ?? SIZE_NEEDED, 1, findGearSku(sku)?.unitPriceCents ?? 0);
  }

  const sorted = [...lines.values()].sort(
    (a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.itemName.localeCompare(b.itemName) || a.colorLabel.localeCompare(b.colorLabel),
  );
  return {
    lines: sorted,
    pieces: sorted.reduce((sum, line) => sum + line.quantity, 0),
    pickCents,
    missingSizePeople: [...missing].sort((a, b) => a.localeCompare(b)),
    studentShoes: students.length,
  };
}
