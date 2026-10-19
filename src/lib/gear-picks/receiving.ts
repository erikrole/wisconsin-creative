import { SIZE_NEEDED, type OrderPlan } from "./order";
import type { GearPickOrderDto, GearPickReceiptDto } from "./types";

export type ReceivingRow = {
  sku: string;
  itemName: string;
  colorLabel: string;
  size: string | null;
  ordered: number;
  received: number;
  /** Ordered minus received. Negative means more arrived than was ordered. */
  outstanding: number;
};

export type OrderPhase = "PLANNING" | "ORDERED" | "RECEIVING" | "RECEIVED";

const keyFor = (sku: string, size: string | null) => `${sku}|${size ?? ""}`;

/**
 * Compare what the plan asks for with what has been checked in, per SKU and size. Units with no size on
 * file can't be received yet and are left out. A receipt for something not on the order still shows up.
 */
export function receivingRows(plan: OrderPlan, receipts: Pick<GearPickReceiptDto, "sku" | "size" | "quantity">[]): ReceivingRow[] {
  const rows = new Map<string, ReceivingRow>();
  for (const line of plan.lines) {
    for (const entry of line.sizes) {
      if (entry.size === SIZE_NEEDED) continue;
      const key = keyFor(line.sku, entry.size);
      const row = rows.get(key) ?? { sku: line.sku, itemName: line.itemName, colorLabel: line.colorLabel, size: entry.size, ordered: 0, received: 0, outstanding: 0 };
      row.ordered += entry.quantity;
      rows.set(key, row);
    }
  }
  for (const receipt of receipts) {
    const key = keyFor(receipt.sku, receipt.size);
    const row = rows.get(key) ?? { sku: receipt.sku, itemName: receipt.sku, colorLabel: "", size: receipt.size, ordered: 0, received: 0, outstanding: 0 };
    row.received += receipt.quantity;
    rows.set(key, row);
  }
  const sorted = [...rows.values()].map((row) => ({ ...row, outstanding: row.ordered - row.received }));
  return sorted.sort(
    (a, b) => a.itemName.localeCompare(b.itemName) || a.colorLabel.localeCompare(b.colorLabel) || (a.size ?? "").localeCompare(b.size ?? "", undefined, { numeric: true }),
  );
}

/** Planning until EQ places the order, then ordered, receiving once anything arrives, received when nothing is outstanding. */
export function orderPhase(order: Pick<GearPickOrderDto, "placedAt">, rows: ReceivingRow[]): OrderPhase {
  const received = rows.reduce((sum, row) => sum + row.received, 0);
  const outstanding = rows.reduce((sum, row) => sum + Math.max(row.outstanding, 0), 0);
  if (received > 0) return outstanding === 0 ? "RECEIVED" : "RECEIVING";
  return order.placedAt ? "ORDERED" : "PLANNING";
}
