import type { Prisma } from "@prisma/client";

const BATTERY_TERMS = [
  "battery",
  "batteries",
  "np-fz100",
  "npfz100",
  "fz100",
  "bp-u",
  "bpu",
  "lp-e6",
  "lpe6",
  "v-mount",
  "vmount",
  "gold mount",
];

const BATTERY_TERM_PATTERNS = BATTERY_TERMS.map((term) =>
  new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i"),
);

export function isBatterySku(sku: {
  name: string;
  category?: string | null;
  categoryRel?: { name: string } | null;
}) {
  const text = [sku.name, sku.category ?? "", sku.categoryRel?.name ?? ""].join(" ").toLowerCase();
  return BATTERY_TERM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Database prefilter for Battery Ops. `contains` is a superset of the
 * word-boundary check in `isBatterySku`, so callers still apply that check
 * and drop substring false positives.
 */
export function batterySkuCandidateWhere(): Prisma.BulkSkuWhereInput {
  const contains = (term: string): Prisma.StringFilter => ({
    contains: term,
    mode: "insensitive",
  });
  return {
    OR: BATTERY_TERMS.flatMap((term) => [
      { name: contains(term) },
      { category: contains(term) },
      { categoryRel: { is: { name: contains(term) } } },
    ]),
  };
}
