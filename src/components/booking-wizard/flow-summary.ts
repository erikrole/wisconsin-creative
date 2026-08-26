export type AvailabilityWarningCounts = {
  conflictCount: number;
  upcomingCommitmentCount: number;
  turnaroundRiskCount: number;
  bulkTurnaroundRiskCount: number;
};

export type Step2PrimaryLabelInput = AvailabilityWarningCounts & {
  itemCount: number;
  unresolvedAssetCount: number;
};

export function getAvailabilityWarningTotal(counts: AvailabilityWarningCounts) {
  return (
    counts.conflictCount +
    counts.upcomingCommitmentCount +
    counts.turnaroundRiskCount +
    counts.bulkTurnaroundRiskCount
  );
}

export function getTurnaroundWarningTotal(counts: AvailabilityWarningCounts) {
  return counts.turnaroundRiskCount + counts.bulkTurnaroundRiskCount;
}

export function getStep2PrimaryActionLabel(input: Step2PrimaryLabelInput) {
  if (input.conflictCount > 0) {
    return input.conflictCount === 1 ? "Resolve conflict" : "Resolve conflicts";
  }
  if (input.itemCount > 0) {
    const itemLabel = `${input.itemCount} item${input.itemCount !== 1 ? "s" : ""}`;
    if (getAvailabilityWarningTotal(input) > 0) return `Review with warnings (${itemLabel})`;
    return `Review (${itemLabel})`;
  }

  if (input.unresolvedAssetCount > 0) {
    return input.unresolvedAssetCount === 1
      ? "Remove unavailable item"
      : "Remove unavailable items";
  }

  return "Select equipment";
}

export type BulkShortage = {
  bulkSkuId: string;
  requested: number;
  available: number;
};

export type SelectedBulkItem = {
  bulkSkuId: string;
  quantity: number;
};

export type BulkShortageRecovery = {
  nextBulkItems: SelectedBulkItem[];
  adjustedCount: number;
  messages: string[];
};

/**
 * Apply a server-reported 409 bulk shortage result to the user's current bulk
 * selection. The server is authoritative: this only ever reduces quantities or
 * removes rows so the user lands back on Step 2 with a buildable selection.
 *
 * Rules:
 * - Never increase a selected quantity.
 * - Clamp a selected quantity down to `available`.
 * - Remove the selected row when `available <= 0` (negatives treated as 0).
 * - Ignore shortage rows for SKUs that are not currently selected.
 * - Preserve unrelated selected bulk rows untouched.
 */
export function applyBulkShortageRecovery(
  selectedBulkItems: SelectedBulkItem[],
  shortages: BulkShortage[],
  skuName?: (bulkSkuId: string) => string | undefined,
): BulkShortageRecovery {
  const shortageBySku = new Map<string, BulkShortage>();
  for (const shortage of shortages) {
    shortageBySku.set(shortage.bulkSkuId, shortage);
  }

  const messages: string[] = [];
  let adjustedCount = 0;
  const nextBulkItems: SelectedBulkItem[] = [];

  for (const item of selectedBulkItems) {
    const shortage = shortageBySku.get(item.bulkSkuId);
    if (!shortage) {
      nextBulkItems.push(item);
      continue;
    }

    const available = Math.max(0, shortage.available);
    const label = skuName?.(item.bulkSkuId) || item.bulkSkuId;

    if (available <= 0) {
      adjustedCount += 1;
      messages.push(`${label} removed (none available)`);
      continue;
    }

    if (available < item.quantity) {
      adjustedCount += 1;
      messages.push(`${label} reduced to ${available} available`);
      nextBulkItems.push({ ...item, quantity: available });
      continue;
    }

    nextBulkItems.push(item);
  }

  return { nextBulkItems, adjustedCount, messages };
}

export function buildAvailabilityReview(counts: AvailabilityWarningCounts) {
  const total = getAvailabilityWarningTotal(counts);
  if (total === 0) return null;

  const turnaroundCount = getTurnaroundWarningTotal(counts);
  const advisoryCount = counts.upcomingCommitmentCount + turnaroundCount;

  if (counts.conflictCount > 0) {
    return {
      tone: "conflict" as const,
      title: "Resolve availability conflicts",
      description:
        "Remove the conflicted items or change the booking dates before reviewing. The server will recheck the final selection when you reserve.",
      total,
      advisoryCount,
      turnaroundCount,
    };
  }

  return {
    tone: "advisory" as const,
    title: "Availability warnings noted",
    description:
      "Upcoming needs and turnaround warnings do not block creation, but pickup and return timing should be confirmed before handoff.",
    total,
    advisoryCount,
    turnaroundCount,
  };
}
