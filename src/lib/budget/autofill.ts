/**
 * What an item can take from the budget line that bought it. Pure so the item page, the API,
 * and the tests agree. Only these four fields move; the serial number is not on an order, so it
 * stays an item field and is shown beside the PO instead. Nothing is written until an admin
 * picks the fields. Reference: docs/AREA_BUDGET.md
 */

export const AUTOFILL_FIELDS = ["purchaseDate", "purchasePrice", "linkUrl", "notes"] as const;
export type AutofillField = (typeof AUTOFILL_FIELDS)[number];

export type AutofillLine = {
  description: string;
  supplier: string | null;
  unitCostCents: number;
  unitCostKnown?: boolean;
  quantityBought: number | null;
  spentCents: number | null;
  purchasedOn: string | null; // YYYY-MM-DD
  poNumber: string | null;
  orderNumber: string | null;
  linkUrl: string | null;
  budgetName: string;
  fiscalYear: string;
};

export type AutofillAsset = {
  purchaseDate: string | null;
  purchasePriceCents: number | null;
  linkUrl: string | null;
  notes: string | null;
};

export type AutofillProposal = {
  field: AutofillField;
  label: string;
  /** Display strings; null when empty. */
  current: string | null;
  proposed: string;
  /** fill: the item has nothing there; differs: it has another value; same: already matches. */
  status: "fill" | "differs" | "same";
};

/** Price per unit: the real spend divided by what was bought when known, otherwise the planned unit cost. */
export function unitPriceCents(line: Pick<AutofillLine, "unitCostCents" | "unitCostKnown" | "quantityBought" | "spentCents">): number | null {
  if (line.spentCents !== null && line.quantityBought !== null && line.quantityBought > 0) {
    return Math.round(line.spentCents / line.quantityBought);
  }
  return line.unitCostKnown === false ? null : line.unitCostCents;
}

/** The one-line trail left in the item's notes so the order can be found again. */
export function purchaseNote(line: AutofillLine): string {
  const parts = [
    line.supplier ? `Bought from ${line.supplier}` : "Bought",
    line.poNumber,
    line.orderNumber ? `Order ${line.orderNumber}` : null,
    `${line.budgetName} ${line.fiscalYear} budget`,
  ];
  return parts.filter(Boolean).join(" · ");
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function status(current: string | null, proposed: string): AutofillProposal["status"] {
  if (current === null || current.trim() === "") return "fill";
  return current === proposed ? "same" : "differs";
}

export function buildAutofill(line: AutofillLine, asset: AutofillAsset): AutofillProposal[] {
  const out: AutofillProposal[] = [];

  if (line.purchasedOn) {
    out.push({
      field: "purchaseDate",
      label: "Purchase date",
      current: asset.purchaseDate,
      proposed: line.purchasedOn,
      status: status(asset.purchaseDate, line.purchasedOn),
    });
  }

  const price = unitPriceCents(line);
  if (price !== null) out.push({
    field: "purchasePrice",
    label: line.spentCents !== null && line.quantityBought !== null && line.quantityBought > 0 ? "Purchase price" : "Planned unit price",
    current: asset.purchasePriceCents === null ? null : money(asset.purchasePriceCents),
    proposed: money(price),
    status: asset.purchasePriceCents === null ? "fill" : asset.purchasePriceCents === price ? "same" : "differs",
  });

  if (line.linkUrl) {
    out.push({
      field: "linkUrl",
      label: "Product link",
      current: asset.linkUrl,
      proposed: line.linkUrl,
      status: status(asset.linkUrl, line.linkUrl),
    });
  }

  const note = purchaseNote(line);
  const existing = asset.notes?.trim() ? asset.notes : null;
  out.push({
    field: "notes",
    label: "Add to notes",
    current: existing,
    proposed: note,
    status: existing === null ? "fill" : existing.includes(note) ? "same" : "differs",
  });

  return out;
}

/** The notes text after applying: the trail is appended, never replacing what the item already says. */
export function applyNote(existing: string | null, line: AutofillLine): string {
  const note = purchaseNote(line);
  if (!existing?.trim()) return note;
  return existing.includes(note) ? existing : `${existing.trimEnd()}\n${note}`;
}
