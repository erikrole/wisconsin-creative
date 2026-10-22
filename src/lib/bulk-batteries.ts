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

/** A family is low when under this share of the units the shop owns. */
export const BATTERY_LOW_STOCK_SHARE = 0.2;

/**
 * Only families at least this big raise a low-stock notification. A family of
 * a handful of batteries running down is routine; a large one (the Sony pool)
 * running low is worth interrupting someone for.
 */
export const BATTERY_NOTIFY_MIN_FAMILY = 20;

/**
 * Low-stock line, relative to family size: the larger of the configured
 * minimum and 20% of owned (non-retired) units. Battery Ops, compatibility
 * lows, Fix Today and the low-stock notification all use it, so they never
 * disagree about which families need attention.
 */
export function batteryLowThreshold(minThreshold: number | null | undefined, ownedQuantity: number) {
  return Math.max(minThreshold ?? 0, Math.ceil(Math.max(0, ownedQuantity) * BATTERY_LOW_STOCK_SHARE));
}

export function shouldNotifyBatteryLow(args: {
  minThreshold: number | null | undefined;
  ownedQuantity: number;
  availableQuantity: number;
}) {
  return (
    args.ownedQuantity >= BATTERY_NOTIFY_MIN_FAMILY &&
    args.availableQuantity < batteryLowThreshold(args.minThreshold, args.ownedQuantity)
  );
}

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
